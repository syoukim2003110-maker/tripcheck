<?php
/*
 * TripCheck — Apple Maps relay for shared hosting.
 *
 * The Apple Maps private key must never reach a browser, so the statically
 * hosted app asks this file instead of Apple. It accepts exactly one thing —
 * a place search — and returns names and coordinates. Contract (shared with
 * scripts/apple-relay-dev.ts and lib/apple-relay-client.ts):
 *
 *   GET apple.php?q=<words>&lang=ja-JP|en-US
 *                 [&near=<lat>,<lon>[&within=<metres>]]
 *                 [&categories=Restaurant,Cafe,Bakery,Hotel][&poi=1]
 *   200 {"results":[{id,name,latitude,longitude,formattedAddress,
 *                    locality,subLocality,countryCode,poiCategory}]}
 *
 *   GET apple.php?op=eta&from=<lat>,<lon>&to=<lat>,<lon>
 *                 &mode=transit|walk|drive[&depart=<ISO 8601>]
 *   200 {"minutes":<int>|null,"distanceMeters":<int>|null}
 *       (null = Apple has no answer for this pair and mode)
 *
 *   GET apple.php?op=route&from=<lat>,<lon>&to=<lat>,<lon>&mode=walk|drive
 *   200 {"minutes":<int>|null,"distanceMeters":<int>|null,"path":[[lat,lon],…]}
 *       (the way along the streets; at most 160 points)
 *
 *   GET apple.php?op=food&near=<lat>,<lon>[&within=<metres>][&name=<words>][&meal=lunch]
 *                 [&genre=cafe|G001…G017][&features=child,non_smoking]
 *       (genre: "cafe" or a genre code of the guide; features: at most two
 *        yes/no filters; both are checked against the lists in ai-spec.json,
 *        the meal advisor's contract, and anything else is refused)
 *   200 {"results":[{id,name,latitude,longitude,address,genre,budget,
 *                    budgetAverage,catch,open,photo,url}]}
 *   GET apple.php?op=place&ids=<Place ID>,<Place ID>…&lang=ja-JP|en-US
 *       (1 to 25 Apple Place IDs, each 4–64 letters and digits)
 *   200 {"results":[…same fields as a search result…],"notFound":[<id>…]}
 *       (an id in neither list could not be looked up this time)
 *
 *   GET apple.php?op=maptoken
 *   200 {"token":"<jwt>","expiresAt":<unix seconds>,"expiresIn":<seconds>}
 *       (a 20-minute MapKit JS token for the place card showing opening
 *        hours; it names this site's own origin, so a copy is useless on
 *        any other site. The private key itself never leaves this file.)
 *
 *       (restaurants listed on HotPepper Gourmet, Japan only; needs
 *        'hotpepper_key' in apple-config.php, else 503 not_configured.
 *        Nothing is stored: the terms forbid keeping a copy.)
 *   4xx/5xx {"code": "..."}
 *
 * Keys live in apple-config.php next to this file (blocked from the web by
 * .htaccess). Requires PHP 7.4+ with the openssl, curl and mbstring extensions.
 *
 * The daily ceiling and the per-client limit are counted in .state/ next to
 * this file. If that folder cannot be created or written the relay answers
 * 503 to everything rather than run without limits. After each upload, open
 * apple.php?op=route&from=35.6812,139.7671&to=35.6586,139.7454&mode=walk
 * once and check that it answers 200, that .state/quota.json now exists,
 * and that opening .state/quota.json in a browser is refused.
 */

declare(strict_types=1);

// Coordinates as Apple sent them (35.6611094), not PHP's 50-digit expansion.
ini_set('serialize_precision', '-1');

const APPLE_ORIGIN = 'https://maps-api.apple.com';
const DAILY_CALL_CEILING = 15000;      // stay inside Apple's daily quota
const PER_CLIENT_PER_MINUTE = 180;     // one trip build is ~20 searches + ~80 travel times
const ALLOWED_CATEGORIES = ['Restaurant', 'Cafe', 'Bakery', 'Hotel'];
const PLACE_IDS_PER_LOOKUP = 25;       // op=place: one trip, 24 places and a hotel

/**
 * The genre codes and yes/no filters a food search may carry: the meal
 * advisor's lists in ai-spec.json, so the relay and the advisor cannot
 * disagree. With the file missing or unreadable only "cafe" is left.
 */
function food_search_lists(): array
{
    $raw = @file_get_contents(__DIR__ . '/ai-spec.json');
    $spec = is_string($raw) ? json_decode($raw, true) : null;
    $strings = fn ($list): array => is_array($list) ? array_values(array_filter($list, fn ($entry): bool => is_string($entry) && preg_match('/^[A-Za-z0-9_]{1,24}$/D', $entry) === 1)) : [];
    return [
        'genres' => $strings($spec['enums']['genres'] ?? null),
        'features' => $strings($spec['enums']['features'] ?? null),
        'featuresPerSearch' => is_int($spec['limits']['featuresPerOption'] ?? null) ? $spec['limits']['featuresPerOption'] : 0,
    ];
}

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

/** Runs $work with an exclusive lock on a small JSON state file. */
function with_state(string $name, callable $work)
{
    $handle = @fopen(state_dir() . '/' . $name . '.json', 'c+');
    // Without the state file there is no daily ceiling and no per-client
    // limit, so the relay refuses rather than run unlimited on the keys.
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
        // A write that fails (disk full) leaves an empty file, which would
        // read back as a fresh day with no calls counted: refuse instead.
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

function base64url(string $bytes): string
{
    return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
}

/** openssl returns an ASN.1 DER signature; JWS ES256 needs raw r‖s (64 bytes). */
function der_to_raw_signature(string $der): string
{
    $offset = 0;
    $read = function () use ($der, &$offset): string {
        if (ord($der[$offset]) !== 0x02) throw new RuntimeException('bad signature');
        $length = ord($der[$offset + 1]);
        $value = substr($der, $offset + 2, $length);
        $offset += 2 + $length;
        return str_pad(ltrim($value, "\x00"), 32, "\x00", STR_PAD_LEFT);
    };
    if (ord($der[0]) !== 0x30) throw new RuntimeException('bad signature');
    // Sequence length is one byte for a P-256 signature (≤ 72 bytes).
    $offset = (ord($der[1]) & 0x80) ? 2 + (ord($der[1]) & 0x7f) : 2;
    $r = $read();
    $s = $read();
    return $r . $s;
}

/** $claims replaces the server-API claims: the browser's MapKit JS token has its own. */
function sign_auth_token(array $config, ?array $claims = null): string
{
    $now = time();
    $header = base64url(json_encode(['alg' => 'ES256', 'kid' => $config['key_id'], 'typ' => 'JWT']));
    $payload = base64url(json_encode($claims ?? [
        'iss' => $config['team_id'],
        'iat' => $now,
        'exp' => $now + 1800,
        'scope' => 'server_api',
    ], JSON_UNESCAPED_SLASHES));
    $key = openssl_pkey_get_private($config['private_key']);
    if ($key === false) throw new RuntimeException('bad private key');
    if (!openssl_sign($header . '.' . $payload, $der, $key, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('signing failed');
    }
    return $header . '.' . $payload . '.' . base64url(der_to_raw_signature($der));
}

/** @return array{0:int,1:?array} HTTP status and decoded JSON body. */
function apple_get(string $url, string $bearer): array
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_HTTPHEADER => $bearer === '' ? ['Accept: application/json'] : ['Accept: application/json', 'Authorization: Bearer ' . $bearer],
        CURLOPT_USERAGENT => 'TripCheck/0.1',
    ]);
    $body = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    $decoded = is_string($body) ? json_decode($body, true) : null;
    return [$status, is_array($decoded) ? $decoded : null];
}

function access_token(array $config, bool $forceRefresh = false): string
{
    return with_state('token', function (array $state, callable $save) use ($config, $forceRefresh): string {
        if (!$forceRefresh && isset($state['token'], $state['expires']) && $state['expires'] > time() + 60) {
            return $state['token'];
        }
        [$status, $body] = apple_get(APPLE_ORIGIN . '/v1/token', sign_auth_token($config));
        if ($status === 429) respond(429, ['code' => 'budget_exhausted']);
        if ($status !== 200 || !is_string($body['accessToken'] ?? null)) respond(502, ['code' => 'unavailable']);
        $lifetime = is_int($body['expiresInSeconds'] ?? null) && $body['expiresInSeconds'] > 0 ? $body['expiresInSeconds'] : 60;
        $save(['token' => $body['accessToken'], 'expires' => time() + $lifetime]);
        return $body['accessToken'];
    });
}

/**
 * Process-wide daily ceiling and a per-client minute window. Lines on the
 * map ($reserveForSearch) stop at 70% of the day's ceiling: the page can
 * draw them from another source, while place, hotel and food search cannot
 * be answered by anything else.
 */
function admit(bool $reserveForSearch = false): void
{
    $client = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '|' . date('Y-m-d'));
    $allowed = with_state('quota', function (array $state, callable $save) use ($client, $reserveForSearch): bool {
        $day = gmdate('Y-m-d');
        $minute = (int) floor(time() / 60);
        if (($state['day'] ?? '') !== $day) $state = ['day' => $day, 'calls' => 0, 'clients' => []];
        if (($state['minute'] ?? 0) !== $minute) {
            $state['minute'] = $minute;
            $state['clients'] = [];
        }
        if ($state['calls'] >= DAILY_CALL_CEILING) return false;
        if ($reserveForSearch && $state['calls'] >= (int) (DAILY_CALL_CEILING * 0.7)) return false;
        $used = $state['clients'][$client] ?? 0;
        if ($used >= PER_CLIENT_PER_MINUTE) return false;
        $state['calls'] += 1;
        $state['clients'][$client] = $used + 1;
        $save($state);
        return true;
    });
    if (!$allowed) respond(429, ['code' => 'budget_exhausted']);
}

/* ------------------------------------------------------------------ request */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') respond(405, ['code' => 'method_not_allowed']);

// Only this site's own pages may use the relay. A browser always sends
// Sec-Fetch-Site on a fetch(); anything cross-site is refused outright.
$fetchSite = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
if ($fetchSite !== '' && $fetchSite !== 'same-origin') respond(403, ['code' => 'forbidden']);
$referer = parse_url($_SERVER['HTTP_REFERER'] ?? '', PHP_URL_HOST);
if (is_string($referer) && $referer !== '' && strcasecmp($referer, explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]) !== 0) {
    respond(403, ['code' => 'forbidden']);
}

$configPath = __DIR__ . '/apple-config.php';
$config = is_file($configPath) ? require $configPath : null;
if (
    !is_array($config)
    || !preg_match('/^[A-Z0-9]{10}$/', (string) ($config['team_id'] ?? ''))
    || !preg_match('/^[A-Z0-9]{10}$/', (string) ($config['key_id'] ?? ''))
    || strpos((string) ($config['private_key'] ?? ''), 'BEGIN PRIVATE KEY') === false
) {
    respond(503, ['code' => 'not_configured']);
}

$coordinatePattern = '/^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/';

if (($_GET['op'] ?? '') === 'maptoken') {
    // The token is tied to the site that asked for it (Apple compares the
    // claim with the browser's Origin header), so one copied out of a page
    // opens no place card anywhere else.
    // The origin written into the token is the site's own, fixed at build
    // time in apple-config.php — never the Host header, which the caller
    // chooses: a server that also answers to another name must not sign
    // tokens for that name. A request for any other host is refused, and so
    // is one that does not come from this site's own page.
    $siteOrigin = (string) ($config['site_origin'] ?? '');
    if (!preg_match('#^https://[a-z0-9.-]{1,253}$#', $siteOrigin)) respond(503, ['code' => 'not_configured']);
    $host = strtolower(explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''))[0]);
    if (!hash_equals(substr($siteOrigin, 8), $host)) respond(403, ['code' => 'forbidden']);
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') !== 'same-origin') respond(403, ['code' => 'forbidden']);
    admit();
    $now = time();
    $expires = $now + 1200;
    try {
        $token = sign_auth_token($config, [
            'iss' => $config['team_id'],
            'iat' => $now,
            'exp' => $expires,
            'origin' => $siteOrigin,
        ]);
    } catch (Throwable $error) {
        respond(502, ['code' => 'unavailable']);
    }
    respond(200, ['token' => $token, 'expiresAt' => $expires, 'expiresIn' => 1200]);
}

if (($_GET['op'] ?? '') === 'eta') {
    $mode = (string) ($_GET['mode'] ?? '');
    $transport = ['transit' => 'Transit', 'walk' => 'Walking', 'drive' => 'Automobile'][$mode] ?? null;
    if (
        $transport === null
        || !preg_match($coordinatePattern, (string) ($_GET['from'] ?? ''), $from)
        || !preg_match($coordinatePattern, (string) ($_GET['to'] ?? ''), $to)
        || abs((float) $from[1]) > 90 || abs((float) $to[1]) > 90
        || abs((float) $from[2]) > 180 || abs((float) $to[2]) > 180
    ) {
        respond(400, ['code' => 'invalid_request']);
    }
    $etaParams = [
        'origin' => sprintf('%.6F,%.6F', (float) $from[1], (float) $from[2]),
        'destinations' => sprintf('%.6F,%.6F', (float) $to[1], (float) $to[2]),
        'transportType' => $transport,
    ];
    if (isset($_GET['depart'])) {
        $departure = strtotime((string) $_GET['depart']);
        if ($departure === false) respond(400, ['code' => 'invalid_request']);
        $etaParams['departureDate'] = gmdate('Y-m-d\TH:i:s\Z', $departure);
    }
    admit();
    $etaUrl = APPLE_ORIGIN . '/v1/etas?' . http_build_query($etaParams, '', '&', PHP_QUERY_RFC3986);
    try {
        [$status, $body] = apple_get($etaUrl, access_token($config));
        if ($status === 401) [$status, $body] = apple_get($etaUrl, access_token($config, true));
    } catch (Throwable $error) {
        respond(502, ['code' => 'unavailable']);
    }
    if ($status === 429) respond(429, ['code' => 'budget_exhausted']);
    // No reply at all (status 0: timeout, no connection) or Apple refusing
    // the relay itself is an outage: the page must be free to ask again.
    if ($status === 0 || $status === 401 || $status === 403) respond(502, ['code' => 'unavailable']);
    // Any other error is what Apple answers for a pair it cannot route in
    // this mode (transit where it has no timetable); that is "no answer".
    $eta = is_array($body) && is_array($body['etas'] ?? null) ? ($body['etas'][0] ?? null) : null;
    $seconds = is_array($eta) && is_numeric($eta['expectedTravelTimeSeconds'] ?? null) ? (float) $eta['expectedTravelTimeSeconds'] : 0;
    if ($status !== 200 || $seconds <= 0) respond(200, ['minutes' => null, 'distanceMeters' => null]);
    $meters = is_numeric($eta['distanceMeters'] ?? null) ? (int) round((float) $eta['distanceMeters']) : null;
    respond(200, ['minutes' => max(1, (int) round($seconds / 60)), 'distanceMeters' => $meters && $meters > 0 ? $meters : null]);
}

if (($_GET['op'] ?? '') === 'route') {
    $mode = (string) ($_GET['mode'] ?? '');
    $transport = ['walk' => 'Walking', 'drive' => 'Automobile'][$mode] ?? null;
    if (
        $transport === null
        || !preg_match($coordinatePattern, (string) ($_GET['from'] ?? ''), $from)
        || !preg_match($coordinatePattern, (string) ($_GET['to'] ?? ''), $to)
        || abs((float) $from[1]) > 90 || abs((float) $to[1]) > 90
        || abs((float) $from[2]) > 180 || abs((float) $to[2]) > 180
    ) {
        respond(400, ['code' => 'invalid_request']);
    }
    admit(true);
    $routeUrl = APPLE_ORIGIN . '/v1/directions?' . http_build_query([
        'origin' => sprintf('%.6F,%.6F', (float) $from[1], (float) $from[2]),
        'destination' => sprintf('%.6F,%.6F', (float) $to[1], (float) $to[2]),
        'transportType' => $transport,
    ], '', '&', PHP_QUERY_RFC3986);
    try {
        [$status, $body] = apple_get($routeUrl, access_token($config));
        if ($status === 401) [$status, $body] = apple_get($routeUrl, access_token($config, true));
    } catch (Throwable $error) {
        respond(502, ['code' => 'unavailable']);
    }
    if ($status === 429) respond(429, ['code' => 'budget_exhausted']);
    // Apple being down, not replying at all (status 0: timeout, no
    // connection) or refusing the relay itself is not "no route": the page
    // must be free to ask again.
    if ($status === 0 || $status === 401 || $status === 403 || $status >= 500) respond(502, ['code' => 'unavailable']);
    $empty = ['minutes' => null, 'distanceMeters' => null, 'path' => []];
    $route = is_array($body) && is_array($body['routes'] ?? null) ? ($body['routes'][0] ?? null) : null;
    $seconds = is_array($route) && is_numeric($route['durationSeconds'] ?? null) ? (float) $route['durationSeconds'] : 0;
    if ($status !== 200 || $seconds <= 0) respond(200, $empty);
    $steps = is_array($body['steps'] ?? null) ? $body['steps'] : [];
    $stepPaths = is_array($body['stepPaths'] ?? null) ? $body['stepPaths'] : [];
    $path = [];
    $stepIndexes = is_array($route['stepIndexes'] ?? null) ? $route['stepIndexes'] : [];
    foreach ($stepIndexes as $stepIndex) {
        $step = $steps[(int) $stepIndex] ?? null;
        $points = is_array($step) ? ($stepPaths[(int) ($step['stepPathIndex'] ?? -1)] ?? null) : null;
        if (!is_array($points)) continue;
        foreach ($points as $point) {
            if (!is_array($point) || !is_numeric($point['latitude'] ?? null) || !is_numeric($point['longitude'] ?? null)) continue;
            $pair = [round((float) $point['latitude'], 5), round((float) $point['longitude'], 5)];
            // Consecutive step paths repeat their shared point.
            if ($path !== [] && $path[count($path) - 1] === $pair) continue;
            $path[] = $pair;
        }
    }
    // The shape survives with far fewer points than Apple sends.
    $limit = 160;
    if (count($path) > $limit) {
        $thin = [];
        $stride = (count($path) - 1) / ($limit - 1);
        for ($index = 0; $index < $limit; $index += 1) $thin[] = $path[(int) round($index * $stride)];
        $path = $thin;
    }
    $meters = is_numeric($route['distanceMeters'] ?? null) ? (int) round((float) $route['distanceMeters']) : null;
    respond(200, ['minutes' => max(1, (int) round($seconds / 60)), 'distanceMeters' => $meters && $meters > 0 ? $meters : null, 'path' => $path]);
}

if (($_GET['op'] ?? '') === 'food') {
    $key = (string) ($config['hotpepper_key'] ?? '');
    if (!preg_match('/^[0-9A-Za-z]{8,64}$/', $key)) respond(503, ['code' => 'not_configured']);
    $name = trim((string) ($_GET['name'] ?? ''));
    $within = isset($_GET['within']) ? (int) $_GET['within'] : 1000;
    if (
        !preg_match($coordinatePattern, (string) ($_GET['near'] ?? ''), $at)
        || abs((float) $at[1]) > 90 || abs((float) $at[2]) > 180
        || mb_strlen($name) > 60 || $within < 1 || $within > 3000
    ) {
        respond(400, ['code' => 'invalid_request']);
    }
    // The meal advisor's conditions: a genre code and yes/no filters, each
    // out of its fixed list. Anything else is refused, not passed on.
    $lists = food_search_lists();
    $genre = (string) ($_GET['genre'] ?? '');
    $features = array_values(array_filter(explode(',', (string) ($_GET['features'] ?? '')), fn ($entry): bool => $entry !== ''));
    if (
        ($genre !== '' && $genre !== 'cafe' && !in_array($genre, $lists['genres'], true))
        || count($features) > $lists['featuresPerSearch']
        || array_diff($features, $lists['features']) !== []
    ) {
        respond(400, ['code' => 'invalid_request']);
    }
    admit();
    // HotPepper takes one of five radii; the smallest that covers the ask.
    $range = $within <= 300 ? 1 : ($within <= 500 ? 2 : ($within <= 1000 ? 3 : ($within <= 2000 ? 4 : 5)));
    $params = ['key' => $key, 'lat' => $at[1], 'lng' => $at[2], 'range' => $range, 'order' => 4, 'count' => 100, 'format' => 'json'];
    if ($name !== '') $params['keyword'] = $name;
    if (($_GET['meal'] ?? '') === 'lunch') $params['lunch'] = 1;
    // "cafe" is cafés and sweets only (the guide's genre G014), for the coffee break.
    if ($genre !== '') $params['genre'] = $genre === 'cafe' ? 'G014' : $genre;
    foreach ($features as $feature) $params[$feature] = 1;
    try {
        [$status, $body] = apple_get('https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986), '');
    } catch (Throwable $error) {
        respond(502, ['code' => 'unavailable']);
    }
    $shops = $body['results']['shop'] ?? null;
    if ($status !== 200 || !is_array($shops)) respond(502, ['code' => 'unavailable']);
    $line = fn ($value): ?string => is_string($value) && trim($value) !== '' ? mb_substr(trim($value), 0, 200) : null;
    $https = fn ($value): ?string => is_string($value) && preg_match('#^https://[a-z0-9.-]+\.(hotp\.jp|hotpepper\.jp)/#', $value) === 1 ? $value : null;
    $results = [];
    foreach (array_slice($shops, 0, 100) as $shop) {
        $name = $line($shop['name'] ?? null);
        if ($name === null || !is_numeric($shop['lat'] ?? null) || !is_numeric($shop['lng'] ?? null)) continue;
        $results[] = [
            'id' => $line($shop['id'] ?? null),
            'name' => $name,
            'latitude' => (float) $shop['lat'],
            'longitude' => (float) $shop['lng'],
            'address' => $line($shop['address'] ?? null),
            'genre' => $line($shop['genre']['name'] ?? null),
            'budget' => $line($shop['budget']['name'] ?? null),
            'budgetAverage' => $line($shop['budget']['average'] ?? null),
            'catch' => $line($shop['catch'] ?? null),
            'open' => $line($shop['open'] ?? null),
            'photo' => $https($shop['photo']['pc']['l'] ?? null),
            'url' => $https($shop['urls']['pc'] ?? null),
        ];
    }
    respond(200, ['results' => $results]);
}

/** One Apple Place object as the page receives it (search and lookup answer alike); null when it has no name or position. */
function place_result($place): ?array
{
    if (!is_array($place)) return null;
    $text = fn ($value): ?string => is_string($value) && trim($value) !== '' ? trim($value) : null;
    $latitude = $place['coordinate']['latitude'] ?? null;
    $longitude = $place['coordinate']['longitude'] ?? null;
    $name = $text($place['name'] ?? null);
    if ($name === null || !is_numeric($latitude) || !is_numeric($longitude)) return null;
    $lines = array_values(array_filter(array_map($text, is_array($place['formattedAddressLines'] ?? null) ? $place['formattedAddressLines'] : [])));
    return [
        'id' => $text($place['id'] ?? null),
        'name' => $name,
        'latitude' => (float) $latitude,
        'longitude' => (float) $longitude,
        'formattedAddress' => implode(', ', $lines),
        'locality' => $text($place['structuredAddress']['locality'] ?? null),
        'subLocality' => $text($place['structuredAddress']['subLocality'] ?? null),
        'countryCode' => $text($place['countryCode'] ?? null),
        'poiCategory' => $text($place['poiCategory'] ?? null),
    ];
}

if (($_GET['op'] ?? '') === 'place') {
    // Places by Apple Place ID. A trip keeps a place found through Apple as
    // its Place ID alone; its name and position are asked for again here
    // each time the trip is opened, and never kept. One request covers a
    // whole trip (24 places and a hotel).
    $ids = explode(',', (string) ($_GET['ids'] ?? ''));
    $language = (string) ($_GET['lang'] ?? '');
    if (
        count($ids) < 1 || count($ids) > PLACE_IDS_PER_LOOKUP || count(array_unique($ids)) !== count($ids)
        || array_filter($ids, fn ($id): bool => preg_match('/^[A-Za-z0-9]{4,64}$/D', $id) !== 1) !== []
        || !in_array($language, ['ja-JP', 'en-US'], true)
    ) {
        respond(400, ['code' => 'invalid_request']);
    }
    admit();
    $placeUrl = APPLE_ORIGIN . '/v1/place?' . http_build_query(['ids' => implode(',', $ids), 'lang' => $language], '', '&', PHP_QUERY_RFC3986);
    try {
        [$status, $body] = apple_get($placeUrl, access_token($config));
        if ($status === 401) [$status, $body] = apple_get($placeUrl, access_token($config, true));
    } catch (Throwable $error) {
        respond(502, ['code' => 'unavailable']);
    }
    if ($status === 429) respond(429, ['code' => 'budget_exhausted']);
    // Anything but a full answer is an outage: the page keeps the places and asks again later.
    if ($status !== 200 || !is_array($body)) respond(502, ['code' => 'unavailable']);
    $results = [];
    foreach (is_array($body['results'] ?? null) ? $body['results'] : [] as $place) {
        $result = place_result($place);
        if ($result !== null && in_array($result['id'], $ids, true)) $results[] = $result;
    }
    // Apple answers FAILED_NOT_FOUND for an id it does not know (any more)
    // and FAILED_INVALID_ID for a malformed one; any other error says
    // nothing about the place, so it is neither found nor gone.
    $notFound = [];
    foreach (is_array($body['errors'] ?? null) ? $body['errors'] : [] as $error) {
        $id = is_array($error) ? ($error['id'] ?? null) : null;
        $code = is_array($error) ? ($error['errorCode'] ?? null) : null;
        if (is_string($id) && in_array($id, $ids, true) && in_array($code, ['FAILED_NOT_FOUND', 'FAILED_INVALID_ID'], true)) $notFound[] = $id;
    }
    respond(200, ['results' => $results, 'notFound' => $notFound]);
}

$query = trim((string) ($_GET['q'] ?? ''));
$language = (string) ($_GET['lang'] ?? '');
$near = null;
if (isset($_GET['near'])) {
    if (!preg_match($coordinatePattern, (string) $_GET['near'], $match)) {
        respond(400, ['code' => 'invalid_request']);
    }
    $near = [(float) $match[1], (float) $match[2]];
    if (abs($near[0]) > 90 || abs($near[1]) > 180) respond(400, ['code' => 'invalid_request']);
}
$within = isset($_GET['within']) ? (int) $_GET['within'] : 0;
$categories = array_values(array_filter(explode(',', (string) ($_GET['categories'] ?? ''))));
if (
    $query === '' || mb_strlen($query) > 120
    || !in_array($language, ['ja-JP', 'en-US'], true)
    || $within < 0 || $within > 5000
    || array_diff($categories, ALLOWED_CATEGORIES) !== []
) {
    respond(400, ['code' => 'invalid_request']);
}

admit();

$params = ['q' => $query, 'lang' => $language];
if (($_GET['poi'] ?? '') === '1') $params['resultTypeFilter'] = 'Poi';
if ($categories !== []) $params['includePoiCategories'] = implode(',', $categories);
if ($near !== null) {
    if ($within > 0) {
        // Apple rejects a request carrying both hints, so a bounded search
        // sends the region alone: north, east, south, west.
        $latSpan = $within / 111320;
        $lonSpan = $within / (111320 * max(0.2, cos(deg2rad($near[0]))));
        $params['searchRegion'] = sprintf('%.5F,%.5F,%.5F,%.5F', $near[0] + $latSpan, $near[1] + $lonSpan, $near[0] - $latSpan, $near[1] - $lonSpan);
        $params['searchRegionPriority'] = 'required';
    } else {
        $params['searchLocation'] = sprintf('%.5F,%.5F', $near[0], $near[1]);
    }
}
$url = APPLE_ORIGIN . '/v1/search?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

try {
    [$status, $body] = apple_get($url, access_token($config));
    if ($status === 401) [$status, $body] = apple_get($url, access_token($config, true));
} catch (Throwable $error) {
    respond(502, ['code' => 'unavailable']);
}
if ($status === 429) respond(429, ['code' => 'budget_exhausted']);
if ($status !== 200 || !is_array($body)) respond(502, ['code' => 'unavailable']);

$results = [];
foreach (array_slice(is_array($body['results'] ?? null) ? $body['results'] : [], 0, 20) as $place) {
    $result = place_result($place);
    if ($result !== null) $results[] = $result;
}
respond(200, ['results' => $results]);
