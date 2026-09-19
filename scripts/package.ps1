$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$packageRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+(\.\d+){0,3}$') { throw 'Invalid manifest version' }
$runtimeFiles = @('manifest.json','background.js','youtube.js','exercise.js','content.js','styles.css','i18n.js','LICENSE',
  '_locales/en/messages.json','_locales/ru/messages.json','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png')
$sourceFiles = $runtimeFiles + @('README.md','README.ru.md','PRIVACY.md','OPERA-SUBMISSION.md','.gitignore','.gitattributes','.prettierrc.json',
  'tests/browser-smoke.cjs','tests/keyboard-smoke.cjs','tests/exercise.test.cjs','tests/storage.test.cjs','tests/i18n.test.cjs','tests/fixture.webm',
  'icons/icon.svg','store-assets/promo.svg','store-assets/promo440x280.png','scripts/render-assets.cjs','scripts/package.ps1')

function Write-VerifiedZip($files, $destination, $prefix) {
  foreach ($relative in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $packageRoot $relative) -PathType Leaf)) { throw "Missing package file: $relative" }
  }
  $stream = [System.IO.File]::Open($destination, [System.IO.FileMode]::Create)
  $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($relative in $files) {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $packageRoot $relative), ($prefix + $relative), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $archive.Dispose(); $stream.Dispose() }
  $check = [System.IO.Compression.ZipFile]::OpenRead($destination)
  try {
    if ($check.Entries.Count -ne $files.Count) { throw 'Unexpected ZIP entries' }
    foreach ($relative in $files) {
      $entryStream = $check.GetEntry($prefix + $relative).Open()
      $hasher = [System.Security.Cryptography.SHA256]::Create()
      try { $actual = [BitConverter]::ToString($hasher.ComputeHash($entryStream)).Replace('-', '') }
      finally { $entryStream.Dispose(); $hasher.Dispose() }
      if ($actual -ne (Get-FileHash -LiteralPath (Join-Path $packageRoot $relative) -Algorithm SHA256).Hash) { throw "ZIP mismatch: $relative" }
    }
  } finally { $check.Dispose() }
  Write-Output "Verified $($files.Count) files: $destination"
}

$outputDirectory = Split-Path -Parent $packageRoot
Write-VerifiedZip $runtimeFiles (Join-Path $outputDirectory "lingo-practice-$($manifest.version)-store.zip") ''
Write-VerifiedZip $sourceFiles (Join-Path $outputDirectory "lingo-practice-$($manifest.version).zip") 'lingo-practice/'
