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
 *   4xx/5xx {"code": "..."}
 *
 * Keys live in apple-config.php next to this file (blocked from the web by
 * .htaccess). Requires PHP 7.4+ with the openssl, curl and mbstring extensions.
 */

declare(strict_types=1);

const APPLE_ORIGIN = 'https://maps-api.apple.com';
const DAILY_CALL_CEILING = 15000;      // stay inside Apple's daily quota
const PER_CLIENT_PER_MINUTE = 40;      // one trip build is ~10–20 searches
const ALLOWED_CATEGORIES = ['Restaurant', 'Cafe', 'Bakery', 'Hotel'];

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
        @file_put_contents($dir . '/.htaccess', "Require all denied\n");
    }
    return $dir;
}

/** Runs $work with an exclusive lock on a small JSON state file. */
function with_state(string $name, callable $work)
{
    $handle = @fopen(state_dir() . '/' . $name . '.json', 'c+');
    if ($handle === false) return $work([], function (array $next): void {});
    flock($handle, LOCK_EX);
    $raw = stream_get_contents($handle);
    $state = is_string($raw) && $raw !== '' ? (json_decode($raw, true) ?: []) : [];
    $save = function (array $next) use ($handle): void {
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($next));
        fflush($handle);
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

function sign_auth_token(array $config): string
{
    $now = time();
    $header = base64url(json_encode(['alg' => 'ES256', 'kid' => $config['key_id'], 'typ' => 'JWT']));
    $payload = base64url(json_encode([
        'iss' => $config['team_id'],
        'iat' => $now,
        'exp' => $now + 1800,
        'scope' => 'server_api',
    ]));
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
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $bearer],
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

/** Process-wide daily ceiling and a per-client minute window. */
function admit(): void
{
    $client = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '|' . date('Y-m-d'));
    $allowed = with_state('quota', function (array $state, callable $save) use ($client): bool {
        $day = gmdate('Y-m-d');
        $minute = (int) floor(time() / 60);
        if (($state['day'] ?? '') !== $day) $state = ['day' => $day, 'calls' => 0, 'clients' => []];
        if (($state['minute'] ?? 0) !== $minute) {
            $state['minute'] = $minute;
            $state['clients'] = [];
        }
        if ($state['calls'] >= DAILY_CALL_CEILING) return false;
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

$query = trim((string) ($_GET['q'] ?? ''));
$language = (string) ($_GET['lang'] ?? '');
$near = null;
if (isset($_GET['near'])) {
    if (!preg_match('/^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/', (string) $_GET['near'], $match)) {
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

$text = fn ($value): ?string => is_string($value) && trim($value) !== '' ? trim($value) : null;
$results = [];
foreach (array_slice(is_array($body['results'] ?? null) ? $body['results'] : [], 0, 20) as $place) {
    $latitude = $place['coordinate']['latitude'] ?? null;
    $longitude = $place['coordinate']['longitude'] ?? null;
    $name = $text($place['name'] ?? null);
    if ($name === null || !is_numeric($latitude) || !is_numeric($longitude)) continue;
    $lines = array_values(array_filter(array_map($text, is_array($place['formattedAddressLines'] ?? null) ? $place['formattedAddressLines'] : [])));
    $results[] = [
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
respond(200, ['results' => $results]);
