<?php
/*
 * TripCheck — one-step deploy for shared hosting.
 *
 * The host's file manager extracts an uploaded zip into a folder named after
 * the zip, one level too deep, and leaves the old build's files behind. This
 * script does the whole job instead:
 *
 *   1. upload tripcheck-site-<random>.zip to the site folder;
 *   2. open  /api/deploy.php?key=<deploy token>.
 *
 * It extracts the newest uploaded build over the site, removes the previous
 * build's hashed assets, and deletes the zip (which carries the Apple key).
 * It can only ever unpack a zip that is already in the site folder, and only
 * with the token from deploy-config.php. Requires the zip extension.
 */

declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function stop(int $status, string $message): void
{
    http_response_code($status);
    echo $message, "\n";
    exit;
}

function remove_tree(string $directory): void
{
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($items as $item) {
        $item->isDir() && !$item->isLink() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
    @rmdir($directory);
}

$configPath = __DIR__ . '/deploy-config.php';
$config = is_file($configPath) ? require $configPath : null;
$token = is_array($config) ? (string) ($config['token'] ?? '') : '';
if (strlen($token) < 32 || !hash_equals($token, (string) ($_GET['key'] ?? ''))) stop(403, 'forbidden');

// Normally this file lives at <site>/api/deploy.php. When the file manager
// has just extracted a build into <site>/tripcheck-site-<random>/, the copy
// inside that folder is the one being run: the site is then one level up, and
// the job is to move the extracted build into place.
$here = dirname(__DIR__);
$nested = preg_match('/^tripcheck-site-[0-9a-f]{12}$/', basename($here)) === 1;
$root = $nested ? dirname($here) : $here;
$isBuildZip = function (string $path): bool {
    return preg_match('/^tripcheck-site-[0-9a-f]{12}\.zip$/', basename($path)) === 1;
};
$zips = array_values(array_filter(glob($root . '/tripcheck-site-*.zip') ?: [], $isBuildZip));

if ($zips === [] && $nested) {
    // The zip is already gone but its extracted folder is here: copy it up.
    $names = [];
    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($here, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($items as $item) {
        $relative = substr($item->getPathname(), strlen($here) + 1);
        $target = $root . '/' . $relative;
        if ($item->isDir()) {
            if (!is_dir($target) && !@mkdir($target, 0755, true)) stop(500, 'フォルダを作れませんでした: ' . $relative);
        } else {
            if (!@copy($item->getPathname(), $target)) stop(500, 'コピーに失敗しました: ' . $relative);
            $names[$relative] = true;
        }
    }
    foreach (['index.html', 'ja/index.html', 'api/apple.php', '.htaccess'] as $required) {
        if (!isset($names[$required])) stop(400, 'TripCheck のビルドではないフォルダです。');
    }
    $removed = 0;
    foreach (['_next/static/chunks', '_next/static/media'] as $directory) {
        foreach (glob($root . '/' . $directory . '/*') ?: [] as $path) {
            if (is_file($path) && !isset($names[$directory . '/' . basename($path)]) && @unlink($path)) $removed += 1;
        }
    }
    foreach (glob($root . '/tripcheck-site-*', GLOB_ONLYDIR) ?: [] as $directory) {
        if (preg_match('/^tripcheck-site-[0-9a-f]{12}$/', basename($directory)) === 1) remove_tree($directory);
    }
    if (is_file($root . '/default_page.png')) @unlink($root . '/default_page.png');
    echo "更新しました（展開済みフォルダから移動）。\n";
    echo 'コピーしたファイル: ', count($names), "\n";
    echo '削除した古いファイル: ', $removed, "\n";
    exit;
}
if ($zips === []) stop(404, 'アップロードされた zip が見つかりません。tripcheck-site-….zip をサイトのフォルダに置いてから、もう一度開いてください。');
usort($zips, function (string $left, string $right): int {
    return filemtime($right) <=> filemtime($left);
});
$zipPath = $zips[0];

if (!class_exists('ZipArchive')) stop(500, 'このサーバーでは zip を展開できません（PHP の zip 拡張がありません）。');
$zip = new ZipArchive();
if ($zip->open($zipPath) !== true) stop(500, 'zip を開けませんでした。アップロードし直してください。');

$names = [];
for ($index = 0; $index < $zip->numFiles; $index += 1) {
    $name = $zip->getNameIndex($index);
    if (!is_string($name) || $name === '' || $name[0] === '/' || strpos($name, '..') !== false || strpos($name, "\0") !== false || strpos($name, '\\') !== false) {
        $zip->close();
        stop(400, 'zip の中に想定外のパスがあります。展開を中止しました。');
    }
    $names[$name] = true;
}
// Only a TripCheck build is unpacked over the site.
foreach (['index.html', 'ja/index.html', 'api/apple.php', '.htaccess'] as $required) {
    if (!isset($names[$required])) {
        $zip->close();
        stop(400, 'TripCheck のビルドではない zip です。展開を中止しました。');
    }
}
if (!$zip->extractTo($root)) {
    $zip->close();
    stop(500, '展開に失敗しました。サイトは前の状態のままか、途中まで更新された状態です。もう一度開いてください。');
}
$fileCount = $zip->numFiles;
$zip->close();

// The previous build's content-hashed files are never requested again.
$removed = 0;
foreach (['_next/static/chunks', '_next/static/media'] as $directory) {
    foreach (glob($root . '/' . $directory . '/*') ?: [] as $path) {
        if (is_file($path) && !isset($names[$directory . '/' . basename($path)]) && @unlink($path)) $removed += 1;
    }
}
// The zip carries the Apple key; nothing of it stays in a public folder.
foreach ($zips as $path) @unlink($path);
foreach (glob($root . '/tripcheck-site-*', GLOB_ONLYDIR) ?: [] as $directory) {
    if (preg_match('/^tripcheck-site-[0-9a-f]{12}$/', basename($directory)) === 1) remove_tree($directory);
}
// The host's placeholder files, if they are still around.
if (is_file($root . '/default_page.png')) @unlink($root . '/default_page.png');

echo "更新しました。\n";
echo '展開したファイル: ', $fileCount, "\n";
echo '削除した古いファイル: ', $removed, "\n";
echo 'zip: 削除済み (', basename($zipPath), ")\n";
