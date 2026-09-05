# Minimal static file server for local preview.
#
# This exists because the site uses ES modules and fetch(), which browsers block
# on file:// — double-clicking index.html will not work. It is a development
# convenience only; GitHub Pages is the real server and does not use this file.
#
#   powershell -ExecutionPolicy Bypass -File serve.ps1
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 9000
#
# Then open http://localhost:8123/ and press Ctrl+C here to stop.

param([string]$Root=$PSScriptRoot,[int]$Port=8123)
$ErrorActionPreference='Stop'
if(-not $Root){ $Root=(Get-Location).Path }
$mime=@{'.html'='text/html; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.mjs'='text/javascript; charset=utf-8';'.json'='application/json; charset=utf-8';'.css'='text/css; charset=utf-8';'.md'='text/plain; charset=utf-8';'.svg'='image/svg+xml';'.ico'='image/x-icon'}
$listener=New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "serving $Root on http://localhost:$Port/"
while($listener.IsListening){
  try{
    $ctx=$listener.GetContext()
    $rel=[System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    # Directory requests resolve to index.html, the way GitHub Pages does. This
    # is what makes a project-subpath URL like /cs-dashboard/ work locally too.
    if($rel -eq '' -or $rel.EndsWith('/')){ $rel="${rel}index.html" }
    $path=Join-Path $Root $rel
    $full=$null
    try{ $full=[System.IO.Path]::GetFullPath($path) }catch{}
    $ctx.Response.Headers.Add('Cache-Control','no-store')
    if($full -and $full.StartsWith([System.IO.Path]::GetFullPath($Root)) -and (Test-Path $full -PathType Leaf)){
      $ext=[System.IO.Path]::GetExtension($full).ToLower()
      $ct=$mime[$ext]; if(-not $ct){ $ct='application/octet-stream' }
      $bytes=[System.IO.File]::ReadAllBytes($full)
      $ctx.Response.ContentType=$ct
      $ctx.Response.StatusCode=200
      $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
    } elseif($rel -eq 'index.html'){
      # no index yet -- serve a blank same-origin page so modules can be imported from the console
      $b=[System.Text.Encoding]::UTF8.GetBytes('<!doctype html><meta charset="utf-8"><title>harness</title><body>harness</body>')
      $ctx.Response.ContentType='text/html; charset=utf-8'; $ctx.Response.StatusCode=200
      $ctx.Response.OutputStream.Write($b,0,$b.Length)
    } else {
      $b=[System.Text.Encoding]::UTF8.GetBytes('404 '+$rel)
      $ctx.Response.StatusCode=404
      $ctx.Response.OutputStream.Write($b,0,$b.Length)
    }
    $ctx.Response.Close()
  } catch { }
}
