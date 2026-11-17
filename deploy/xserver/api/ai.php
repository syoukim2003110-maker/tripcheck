<?php
/*
 * TripCheck — the meal advisor's relay for shared hosting.
 *
 * The page sends a short description of the plan (the "brief") and gets back,
 * for each open lunch or dinner, up to three sets of search conditions with
 * one sentence each. The AI keys stay in ai-config.php next to this file.
 * Contract (shared with lib/shiori/meal-advice-contract.ts and the local
 * stand-in, lib/server/meal-advice-relay.ts in scripts/apple-relay-dev.ts):
 *
 *   POST ai.php   Content-Type: application/json, at most 8 KB
 *        {"task":"meals","locale":"ja"|"en","brief":{…},
 *         "only":["d1-lunch",…],"given":[{"slot","genre","keyword"}]}
 *        {"task":"meal-refine","locale":…,"brief":{…},
 *         "refine":{"slot":"d1-lunch","previous":[…],"ask":"cheaper","wish":""}}
 *   200  {"slots":[{"slot":"d1-lunch","options":[{"role","genre","keyword",
 *                   "budgetMax","features","withinMeters","reason"}]}]}
 *   4xx/5xx {"code":"invalid_request"|"forbidden"|"method_not_allowed"|
 *            "not_configured"|"budget_exhausted"|"unavailable"}
 *
 * The caller supplies no prompt, model, schema or token limit: those, the
 * lists every value is checked against and the limits live in ai-spec.json
 * next to this file (blocked from the web by .htaccess, like ai-config.php).
 * The brief is validated and rebuilt before it is sent on; the model's answer
 * is validated before it is sent back. Claude is asked first; if it fails
 * while there is still time to answer in, OpenAI is asked once. A provider's
 * error text is never passed on.
 *
 * Nothing is stored except the counters in .state/ai-quota.json. If that
 * file cannot be written the relay answers 503 rather than run unlimited.
 * Requires PHP 7.4+ with the curl and mbstring extensions.
 */

declare(strict_types=1);

ini_set('serialize_precision', '-1');

function respond(int $status, array $body): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function state_dir(): string
{
    $dir = __DIR__ . '/.state';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
        @file_put_contents($dir . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
    }
    return $dir;
}

/** Runs $work with an exclusive lock on a small JSON state file (as in apple.php). */
function with_state(string $name, callable $work)
{
    $handle = @fopen(state_dir() . '/' . $name . '.json', 'c+');
    // Without the state file there is no ceiling at all, so the relay
    // refuses rather than run unlimited on the keys.
    if ($handle === false) respond(503, ['code' => 'unavailable']);
    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        respond(503, ['code' => 'unavailable']);
    }
    $raw = stream_get_contents($handle);
    $state = is_string($raw) && $raw !== '' ? (json_decode($raw, true) ?: []) : [];
    $save = function (array $next) use ($handle): void {
        ftruncate($handle, 0);
        rewind($handle);
        $json = (string) json_encode($next);
        // A short write would leave half a count on disk.
        if (fwrite($handle, $json) !== strlen($json) || !fflush($handle)) {
            flock($handle, LOCK_UN);
            fclose($handle);
            respond(503, ['code' => 'unavailable']);
        }
    };
    try {
        return $work($state, $save);
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

/**
 * Who a request is counted against. An IPv6 line is handed a whole /64 of
 * addresses, so those count as one client; an IPv4 address (also when written
 * as an IPv6-mapped one) counts as itself.
 */
function client_group(string $address): string
{
    $packed = @inet_pton($address);
    if (!is_string($packed) || strlen($packed) !== 16) return $address;
    if (substr($packed, 0, 12) === "\0\0\0\0\0\0\0\0\0\0\xff\xff") return (string) inet_ntop(substr($packed, 12));
    return bin2hex(substr($packed, 0, 8)) . '::/64';
}

/**
 * The site's ceiling for a day and each client's share of it (so many a
 * minute, so many a day). A request is counted when it is let through.
 */
function admit(array $limits): void
{
    // The day in the hash is the day the counters are kept for (UTC), so a
    // client's count for the day cannot start again halfway through it.
    $client = hash('sha256', client_group((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown')) . '|' . gmdate('Y-m-d'));
    $allowed = with_state('ai-quota', function (array $state, callable $save) use ($client, $limits): bool {
        $day = gmdate('Y-m-d');
        $minute = (int) floor(time() / 60);
        if (($state['day'] ?? '') !== $day) $state = ['day' => $day, 'calls' => 0, 'clients' => [], 'minute' => $minute, 'minuteClients' => []];
        if (($state['minute'] ?? 0) !== $minute) {
            $state['minute'] = $minute;
            $state['minuteClients'] = [];
        }
        $today = (int) ($state['clients'][$client] ?? 0);
        $thisMinute = (int) ($state['minuteClients'][$client] ?? 0);
        $calls = (int) ($state['calls'] ?? 0);
        if ($calls >= $limits['dailyCalls']) return false;
        if ($today >= $limits['perClientPerDay'] || $thisMinute >= $limits['perClientPerMinute']) return false;
        $state['calls'] = $calls + 1;
        $state['clients'][$client] = $today + 1;
        $state['minuteClients'][$client] = $thisMinute + 1;
        $save($state);
        return true;
    });
    if (!$allowed) respond(429, ['code' => 'budget_exhausted']);
}

/* --------------------------------------------------------------- validation
 * The same rules as lib/shiori/meal-advice-contract.ts, with every list and
 * limit taken from ai-spec.json. Each function returns the cleaned value, or
 * null when the input must be refused.
 */

function is_list_array($value): bool
{
    return is_array($value) && ($value === [] || array_keys($value) === range(0, count($value) - 1));
}

function is_record($value): bool
{
    return is_array($value) && !is_list_array($value);
}

/** Trimmed, control and invisible format characters removed; null when not text or too long. */
function clean_text($value, int $maxChars): ?string
{
    if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) return null;
    $text = preg_replace('/[\p{Cc}\p{Cf}]/u', '', $value);
    if (!is_string($text)) return null;
    $text = preg_replace('/^[\s\x{00A0}\x{3000}]+|[\s\x{00A0}\x{3000}]+$/u', '', $text);
    if (!is_string($text) || mb_strlen($text, 'UTF-8') > $maxChars) return null;
    return $text;
}

function clean_minutes($value, int $max): ?int
{
    return is_int($value) && $value >= 0 && $value <= $max ? $value : null;
}

function clean_clock($value): ?string
{
    return is_string($value) && preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $value) === 1 ? $value : null;
}

function clean_day($value, int $max): ?int
{
    return is_int($value) && $value >= 1 && $value <= $max ? $value : null;
}

/** A search word: letters, kana and kanji only. Returns [ok, word|null]. */
function clean_keyword($value, int $maxChars): array
{
    if ($value === null) return [true, null];
    if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) return [false, null];
    $word = (string) preg_replace('/^[\s\x{00A0}\x{3000}]+|[\s\x{00A0}\x{3000}]+$/u', '', $value);
    if ($word === '') return [true, null];
    if (preg_match('/^\p{L}+$/Du', $word) !== 1 || mb_strlen($word, 'UTF-8') > $maxChars) return [false, null];
    return [true, $word];
}

/** Money, ratings and links are the directory's to state, never the model's. */
function reason_allowed(string $reason, int $maxChars): bool
{
    if ($reason === '' || mb_strlen($reason, 'UTF-8') > $maxChars) return false;
    return preg_match('/https?:|:\/\/|www\.|[円¥￥$＄★☆]|\byen\b|\bJPY\b/iu', $reason) !== 1;
}

/** role, genre, keyword, budgetMax, features, withinMeters — each out of its list. */
function clean_conditions($input, array $spec): ?array
{
    if (!is_record($input)) return null;
    $enums = $spec['enums'];
    $limits = $spec['limits'];
    $role = $input['role'] ?? null;
    $genre = $input['genre'] ?? null;
    $budgetMax = $input['budgetMax'] ?? null;
    $withinMeters = $input['withinMeters'] ?? null;
    $features = $input['features'] ?? [];
    [$keywordOk, $keyword] = clean_keyword($input['keyword'] ?? null, $limits['keywordChars']);
    if (!is_string($role) || !in_array($role, $enums['roles'], true)) return null;
    if ($genre !== null && (!is_string($genre) || !in_array($genre, $enums['genres'], true))) return null;
    if ($budgetMax !== null && (!is_int($budgetMax) || !in_array($budgetMax, $enums['budgetMax'], true))) return null;
    if (!is_int($withinMeters) || !in_array($withinMeters, $enums['withinMeters'], true)) return null;
    // "Least walking" over shops a long walk away would be the page contradicting itself.
    if (in_array($role, $enums['closeRoles'], true) && $withinMeters > $limits['closeRoleMeters']) return null;
    if (!$keywordOk) return null;
    if (!is_list_array($features) || count($features) > $limits['featuresPerOption']) return null;
    $kept = [];
    foreach ($features as $feature) {
        if (!is_string($feature) || !in_array($feature, $enums['features'], true)) return null;
        if (!in_array($feature, $kept, true)) $kept[] = $feature;
    }
    return ['role' => $role, 'genre' => $genre, 'keyword' => $keyword, 'budgetMax' => $budgetMax, 'features' => $kept, 'withinMeters' => $withinMeters];
}

function clean_option($input, string $locale, array $spec): ?array
{
    $conditions = clean_conditions($input, $spec);
    if ($conditions === null) return null;
    $reason = clean_text($input['reason'] ?? null, 400);
    if ($reason === null || !reason_allowed($reason, $spec['limits']['reasonChars'][$locale])) return null;
    $conditions['reason'] = $reason;
    return $conditions;
}

/** A value that may be absent or null; otherwise it must be in the list. Returns [ok, value|null]. */
function nullable_enum($value, array $list): array
{
    if ($value === null) return [true, null];
    return is_string($value) && in_array($value, $list, true) ? [true, $value] : [false, null];
}

function clean_stop($input, array $spec): ?array
{
    if (!is_record($input)) return null;
    $kind = $input['kind'] ?? null;
    $start = clean_clock($input['start'] ?? null);
    $stay = clean_minutes($input['stayMinutes'] ?? null, $spec['limits']['minutes']);
    if (!is_string($kind) || !in_array($kind, $spec['enums']['kinds'], true) || $start === null || $stay === null) return null;
    $stop = ['kind' => $kind, 'start' => $start, 'stayMinutes' => $stay];
    if (($input['name'] ?? null) !== null) {
        $name = clean_text($input['name'], $spec['limits']['nameChars']);
        if ($name === null) return null;
        if ($name !== '') $stop['name'] = $name;
    }
    if (($input['meal'] ?? null) !== null) {
        if (!is_string($input['meal']) || !in_array($input['meal'], $spec['enums']['meals'], true)) return null;
        $stop['meal'] = $input['meal'];
    }
    if (($input['booked'] ?? null) === true) $stop['booked'] = true;
    return $stop;
}

/** The brief rebuilt from validated parts; nothing the contract does not name is copied. */
function clean_brief($input, array $spec): ?array
{
    $limits = $spec['limits'];
    $enums = $spec['enums'];
    if (!is_record($input) || !is_list_array($input['days'] ?? null) || !is_list_array($input['slots'] ?? null)) return null;
    if (count($input['days']) < 1 || count($input['days']) > $limits['days']) return null;
    if (count($input['slots']) < 1 || count($input['slots']) > $limits['slots']) return null;

    $city = null;
    if (($input['city'] ?? null) !== null) {
        $city = clean_text($input['city'], $limits['cityChars']);
        if ($city === null) return null;
        if ($city === '') $city = null;
    }

    $days = [];
    $dayNumbers = [];
    $stopCount = 0;
    foreach ($input['days'] as $rawDay) {
        if (!is_record($rawDay) || !is_list_array($rawDay['stops'] ?? null)) return null;
        $day = clean_day($rawDay['day'] ?? null, $limits['days']);
        [$weekdayOk, $weekday] = nullable_enum($rawDay['weekday'] ?? null, $enums['weekdays']);
        [$weatherOk, $weather] = nullable_enum($rawDay['weather'] ?? null, $enums['weather']);
        $walk = clean_minutes($rawDay['walkMinutes'] ?? null, $limits['minutes']);
        if ($day === null || !$weekdayOk || !$weatherOk || $walk === null || in_array($day, $dayNumbers, true)) return null;
        $stopCount += count($rawDay['stops']);
        if ($stopCount > $limits['stops']) return null;
        $stops = [];
        foreach ($rawDay['stops'] as $rawStop) {
            $stop = clean_stop($rawStop, $spec);
            if ($stop === null) return null;
            $stops[] = $stop;
        }
        $dayNumbers[] = $day;
        $days[] = ['day' => $day, 'weekday' => $weekday, 'weather' => $weather, 'walkMinutes' => $walk, 'stops' => $stops];
    }

    $slots = [];
    $slotIds = [];
    foreach ($input['slots'] as $rawSlot) {
        if (!is_record($rawSlot)) return null;
        $day = clean_day($rawSlot['day'] ?? null, $limits['days']);
        $meal = $rawSlot['meal'] ?? null;
        $time = clean_clock($rawSlot['time'] ?? null);
        [$afterOk, $after] = nullable_enum($rawSlot['afterKind'] ?? null, $enums['kinds']);
        [$beforeOk, $before] = nullable_enum($rawSlot['beforeKind'] ?? null, $enums['kinds']);
        $until = null;
        if (($rawSlot['minutesUntilNext'] ?? null) !== null) {
            $until = clean_minutes($rawSlot['minutesUntilNext'], $limits['minutes']);
            if ($until === null) return null;
        }
        if ($day === null || !is_string($meal) || !in_array($meal, $enums['meals'], true) || $time === null || !$afterOk || !$beforeOk) return null;
        // The id is the day and the meal, so it cannot carry anything else.
        $id = 'd' . $day . '-' . $meal;
        if (($rawSlot['slot'] ?? null) !== $id || in_array($id, $slotIds, true) || !in_array($day, $dayNumbers, true)) return null;
        $slotIds[] = $id;
        $slots[] = ['slot' => $id, 'day' => $day, 'meal' => $meal, 'time' => $time, 'minutesUntilNext' => $until, 'afterKind' => $after, 'beforeKind' => $before];
    }

    $rawPrefs = $input['prefs'] ?? null;
    // json_decode turns {} into an empty array, which is a valid "nothing chosen".
    if ($rawPrefs !== null && $rawPrefs !== [] && !is_record($rawPrefs)) return null;
    $rawPrefs = is_array($rawPrefs) ? $rawPrefs : [];
    [$partyOk, $party] = nullable_enum($rawPrefs['party'] ?? null, $enums['party']);
    [$budgetOk, $budget] = nullable_enum($rawPrefs['budget'] ?? null, $enums['budget']);
    $wish = ($rawPrefs['wish'] ?? null) === null ? '' : clean_text($rawPrefs['wish'], $limits['wishChars']);
    if (!$partyOk || !$budgetOk || $wish === null) return null;

    return ['city' => $city, 'days' => $days, 'slots' => $slots, 'prefs' => ['party' => $party, 'budget' => $budget, 'wish' => $wish]];
}

function clean_refine($input, array $brief, array $spec): ?array
{
    if (!is_record($input) || !is_list_array($input['previous'] ?? null)) return null;
    if (count($input['previous']) > $spec['limits']['optionsPerSlot']) return null;
    $ask = $input['ask'] ?? null;
    $slot = $input['slot'] ?? null;
    $wish = ($input['wish'] ?? null) === null ? '' : clean_text($input['wish'], $spec['limits']['wishChars']);
    if (!is_string($ask) || !in_array($ask, $spec['enums']['asks'], true) || $wish === null || !is_string($slot)) return null;
    if (!in_array($slot, array_column($brief['slots'], 'slot'), true)) return null;
    // Asking with words needs the words.
    if ($ask === 'wish' && $wish === '') return null;
    $previous = [];
    foreach ($input['previous'] as $entry) {
        $conditions = clean_conditions($entry, $spec);
        if ($conditions === null) return null;
        $previous[] = $conditions;
    }
    return ['slot' => $slot, 'previous' => $previous, 'ask' => $ask, 'wish' => $wish];
}

/** The slots to answer now: some of the brief's, each once, at most slotsPerCall. Left out, it is all of them. */
function clean_only($input, array $brief, array $spec): ?array
{
    $slotIds = array_column($brief['slots'], 'slot');
    $listed = $input === null ? $slotIds : $input;
    if (!is_list_array($listed) || count($listed) < 1 || count($listed) > $spec['limits']['slotsPerCall']) return null;
    $only = [];
    foreach ($listed as $entry) {
        if (!is_string($entry) || in_array($entry, $only, true) || !in_array($entry, $slotIds, true)) return null;
        $only[] = $entry;
    }
    return $only;
}

/** What earlier turns put first, for other slots of the brief than the ones asked now. */
function clean_given($input, array $brief, array $only, array $spec): ?array
{
    $listed = $input === null ? [] : $input;
    if (!is_list_array($listed) || count($listed) > $spec['limits']['slots']) return null;
    $slotIds = array_column($brief['slots'], 'slot');
    $given = [];
    $seen = [];
    foreach ($listed as $entry) {
        if (!is_record($entry) || !is_string($entry['slot'] ?? null)) return null;
        $slot = $entry['slot'];
        $genre = $entry['genre'] ?? null;
        [$keywordOk, $keyword] = clean_keyword($entry['keyword'] ?? null, $spec['limits']['keywordChars']);
        if ($genre !== null && (!is_string($genre) || !in_array($genre, $spec['enums']['genres'], true))) return null;
        if (!$keywordOk || in_array($slot, $only, true) || in_array($slot, $seen, true) || !in_array($slot, $slotIds, true)) return null;
        $seen[] = $slot;
        $given[] = ['slot' => $slot, 'genre' => $genre, 'keyword' => $keyword];
    }
    return $given;
}

/** The whole request, rebuilt clean: task, locale, brief and (for a refinement) refine. */
function clean_request($body, array $spec): ?array
{
    if (!is_record($body)) return null;
    $task = $body['task'] ?? null;
    $locale = $body['locale'] ?? null;
    if (!is_string($task) || !in_array($task, $spec['enums']['tasks'], true)) return null;
    if (!is_string($locale) || !in_array($locale, $spec['enums']['locales'], true)) return null;
    $brief = clean_brief($body['brief'] ?? null, $spec);
    if ($brief === null) return null;
    if ($task === 'meals') {
        $only = clean_only($body['only'] ?? null, $brief, $spec);
        $given = $only === null ? null : clean_given($body['given'] ?? null, $brief, $only, $spec);
        if ($only === null || $given === null) return null;
        return ['task' => $task, 'locale' => $locale, 'brief' => $brief, 'only' => $only, 'given' => $given];
    }
    $refine = clean_refine($body['refine'] ?? null, $brief, $spec);
    if ($refine === null) return null;
    return ['task' => $task, 'locale' => $locale, 'brief' => $brief, 'refine' => $refine];
}

/**
 * The model's answer reduced to what the contract allows: only the slots
 * asked about, each once, at most three valid options each, every role
 * different. An option that breaks a rule is left out, not repaired. Null
 * when nothing usable is left.
 */
function clean_answer($input, array $slotIds, string $locale, array $spec): ?array
{
    if (!is_record($input) || !is_list_array($input['slots'] ?? null)) return null;
    $perSlot = $spec['limits']['optionsPerSlot'];
    $slots = [];
    $seen = [];
    foreach (array_slice($input['slots'], 0, $spec['limits']['slots'] * 2) as $rawSlot) {
        if (!is_record($rawSlot) || !is_string($rawSlot['slot'] ?? null) || !is_list_array($rawSlot['options'] ?? null)) continue;
        $slot = $rawSlot['slot'];
        if (!in_array($slot, $slotIds, true) || in_array($slot, $seen, true)) continue;
        $options = [];
        $roles = [];
        foreach (array_slice($rawSlot['options'], 0, $perSlot * 2) as $rawOption) {
            if (count($options) >= $perSlot) break;
            $option = clean_option($rawOption, $locale, $spec);
            if ($option === null || in_array($option['role'], $roles, true)) continue;
            $roles[] = $option['role'];
            $options[] = $option;
        }
        if ($options === []) continue;
        $seen[] = $slot;
        $slots[] = ['slot' => $slot, 'options' => $options];
    }
    return $slots === [] ? null : ['slots' => $slots];
}

/* ---------------------------------------------------------------- providers */

/** @return array{0:int,1:?array} HTTP status (0 = no reply) and decoded JSON body. */
function post_json(string $url, array $headers, array $payload, int $timeoutSeconds): array
{
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) return [0, null];
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $json,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeoutSeconds,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_USERAGENT => 'TripCheck/0.1',
    ]);
    $body = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    // A reply cut off by the timeout still carries a status; it is no reply.
    if (!is_string($body)) return [0, null];
    $decoded = json_decode($body, true);
    return [$status, is_array($decoded) ? $decoded : null];
}

function system_prompt(array $spec, string $task): string
{
    return implode("\n\n", array_merge($spec['system']['common'], $spec['system'][$task]));
}

/** The user message: the cleaned request and nothing else. */
function user_message(array $request): string
{
    $message = ['locale' => $request['locale'], 'brief' => $request['brief']];
    if ($request['task'] === 'meal-refine') {
        $message['refine'] = $request['refine'];
    } else {
        $message['only'] = $request['only'];
        $message['given'] = $request['given'];
    }
    return (string) json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/**
 * Claude Messages API. Thinking is always on for this model and is steered
 * by effort; the answer's shape is guaranteed by a JSON schema (this model
 * refuses a forced tool call). Returns the decoded JSON of the answer or null.
 */
function ask_anthropic(array $spec, array $request, string $key, int $timeoutSeconds)
{
    $provider = $spec['providers']['anthropic'];
    $headers = ['Content-Type: application/json', 'x-api-key: ' . $key, 'anthropic-version: ' . $provider['version']];
    if (is_string($provider['beta'] ?? null)) $headers[] = 'anthropic-beta: ' . $provider['beta'];
    $payload = [
        'model' => $provider['model'],
        'max_tokens' => $provider['maxTokens'],
        'output_config' => ['effort' => $provider['effort'], 'format' => ['type' => 'json_schema', 'schema' => $spec['answerSchema']]],
        'system' => [['type' => 'text', 'text' => system_prompt($spec, $request['task']), 'cache_control' => ['type' => 'ephemeral']]],
        'messages' => [['role' => 'user', 'content' => user_message($request)]],
    ];
    if (is_string($provider['fallbacks'] ?? null)) $payload['fallbacks'] = $provider['fallbacks'];
    [$status, $body] = post_json($provider['url'], $headers, $payload, $timeoutSeconds);
    if ($status !== 200 || !is_array($body)) return null;
    // Checked before the content is read: on a refusal or at the token limit
    // the content is empty or partial.
    if (($body['stop_reason'] ?? null) !== 'end_turn' || !is_array($body['content'] ?? null)) return null;
    $text = '';
    foreach ($body['content'] as $block) {
        if (is_array($block) && ($block['type'] ?? null) === 'text' && is_string($block['text'] ?? null)) $text .= $block['text'];
    }
    return $text === '' ? null : json_decode($text, true);
}

/** OpenAI Responses API with the same prompt and schema; nothing is stored there. */
function ask_openai(array $spec, array $request, string $key, int $timeoutSeconds)
{
    $provider = $spec['providers']['openai'];
    $payload = [
        'model' => $provider['model'],
        'store' => false,
        'reasoning' => ['effort' => $provider['reasoningEffort']],
        'max_output_tokens' => $provider['maxOutputTokens'],
        'input' => [
            ['role' => 'system', 'content' => system_prompt($spec, $request['task'])],
            ['role' => 'user', 'content' => user_message($request)],
        ],
        'text' => ['format' => ['type' => 'json_schema', 'name' => 'meal_advice', 'schema' => $spec['answerSchema'], 'strict' => true]],
    ];
    [$status, $body] = post_json($provider['url'], ['Content-Type: application/json', 'Authorization: Bearer ' . $key], $payload, $timeoutSeconds);
    if ($status !== 200 || !is_array($body)) return null;
    if (($body['status'] ?? null) !== 'completed' || !is_array($body['output'] ?? null)) return null;
    $text = '';
    foreach ($body['output'] as $item) {
        if (!is_array($item) || ($item['type'] ?? null) !== 'message' || !is_array($item['content'] ?? null)) continue;
        foreach ($item['content'] as $part) {
            if (!is_array($part)) continue;
            if (($part['type'] ?? null) === 'refusal') return null;
            if (($part['type'] ?? null) === 'output_text' && is_string($part['text'] ?? null)) $text .= $part['text'];
        }
    }
    return $text === '' ? null : json_decode($text, true);
}

/* ------------------------------------------------------------------ request */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respond(405, ['code' => 'method_not_allowed']);

// Only this site's own pages may use the relay, and the request has to say
// so itself: a current browser marks the page's fetch() "same-origin" in
// Sec-Fetch-Site, and an older one (which sends no such header) still sends
// the page's Origin with a POST. A request with neither is not from the page.
$host = explode(':', $_SERVER['HTTP_HOST'] ?? '')[0];
$fetchSite = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
$origin = parse_url($_SERVER['HTTP_ORIGIN'] ?? '', PHP_URL_HOST);
$sameOrigin = is_string($origin) && $origin !== '' && $host !== '' && strcasecmp($origin, $host) === 0;
if ($fetchSite !== '' ? $fetchSite !== 'same-origin' : !$sameOrigin) respond(403, ['code' => 'forbidden']);
if (is_string($origin) && $origin !== '' && !$sameOrigin) respond(403, ['code' => 'forbidden']);
$referer = parse_url($_SERVER['HTTP_REFERER'] ?? '', PHP_URL_HOST);
if (is_string($referer) && $referer !== '' && strcasecmp($referer, $host) !== 0) {
    respond(403, ['code' => 'forbidden']);
}
// A form on another site cannot send JSON without asking first.
if (stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== 0) respond(400, ['code' => 'invalid_request']);

$specRaw = @file_get_contents(__DIR__ . '/ai-spec.json');
$spec = is_string($specRaw) ? json_decode($specRaw, true) : null;
if (!is_array($spec) || !is_array($spec['limits'] ?? null) || !is_array($spec['enums'] ?? null) || !is_array($spec['providers'] ?? null) || !is_array($spec['system'] ?? null) || !is_array($spec['answerSchema'] ?? null)) {
    respond(503, ['code' => 'not_configured']);
}

$configPath = __DIR__ . '/ai-config.php';
$config = is_file($configPath) ? require $configPath : null;
$keyPattern = '/^[\x21-\x7e]{20,300}$/D';
$anthropicKey = is_array($config) && preg_match($keyPattern, (string) ($config['anthropic_key'] ?? '')) === 1 ? (string) $config['anthropic_key'] : null;
$openaiKey = is_array($config) && preg_match($keyPattern, (string) ($config['openai_key'] ?? '')) === 1 ? (string) $config['openai_key'] : null;
if ($anthropicKey === null && $openaiKey === null) respond(503, ['code' => 'not_configured']);

$bodyLimit = (int) $spec['limits']['bodyBytes'];
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $bodyLimit) respond(400, ['code' => 'invalid_request']);
// One byte more than allowed is read, so an oversized body is seen as such.
$rawBody = file_get_contents('php://input', false, null, 0, $bodyLimit + 1);
if (!is_string($rawBody) || $rawBody === '' || strlen($rawBody) > $bodyLimit) respond(400, ['code' => 'invalid_request']);

$request = clean_request(json_decode($rawBody, true, 16), $spec);
if ($request === null) respond(400, ['code' => 'invalid_request']);

admit($spec['limits']);

// The two providers share one length of time, shorter than the page waits.
$total = (int) $spec['limits']['totalSeconds'];
$begun = microtime(true);
@set_time_limit($total + 20);

$slotIds = $request['task'] === 'meal-refine' ? [$request['refine']['slot']] : $request['only'];
$answer = null;
try {
    if ($anthropicKey !== null) {
        $timeout = min((int) $spec['providers']['anthropic']['timeoutSeconds'], $total);
        $answer = clean_answer(ask_anthropic($spec, $request, $anthropicKey, $timeout), $slotIds, $request['locale'], $spec);
    }
    // OpenAI is asked only while enough time is left to answer in: after a
    // Claude call that ran out the clock the page has stopped listening, and
    // a second call would be paid for and answer nobody.
    $left = (int) floor($total - (microtime(true) - $begun));
    if ($answer === null && $openaiKey !== null && $left >= (int) $spec['providers']['openai']['minSeconds']) {
        $timeout = min((int) $spec['providers']['openai']['timeoutSeconds'], $left);
        $answer = clean_answer(ask_openai($spec, $request, $openaiKey, $timeout), $slotIds, $request['locale'], $spec);
    }
} catch (Throwable $error) {
    $answer = null;
}
if ($answer === null) respond(502, ['code' => 'unavailable']);
respond(200, $answer);
