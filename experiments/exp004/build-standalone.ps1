$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $root 'index.html'
$image = Join-Path $root 'reference.png'
$output = Join-Path $root 'showcase-image-faithful.html'
$html = [System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8)
$dataUri = 'data:image/png;base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($image))
if (-not $html.Contains('src="reference.png"')) { throw 'Reference image marker was not found.' }
$html = $html.Replace('src="reference.png"', 'src="' + $dataUri + '"')
[System.IO.File]::WriteAllText($output, $html, [System.Text.UTF8Encoding]::new($false))
Write-Output $output
