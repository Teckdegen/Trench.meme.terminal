# Manual fallback: push bot/ → Trench.meme.bot from your local machine.
# Normally the GitHub Action does this automatically on every push to main.
# Use this if the Action is down or you need to force a sync.
#
# Usage:
#   ./scripts/sync-bot.ps1

$ErrorActionPreference = "Stop"

$BotRepo  = "https://github.com/Teckdegen/Trench.meme.bot.git"
$Prefix   = "bot"
$Branch   = "bot-sync"

Write-Host "▶ Splitting bot/ into a branch..." -ForegroundColor Cyan
git subtree split --prefix=$Prefix -b $Branch

Write-Host "▶ Force-pushing to $BotRepo (main)..." -ForegroundColor Cyan
git push $BotRepo "${Branch}:main" --force

Write-Host "▶ Cleaning up local split branch..." -ForegroundColor Cyan
git branch -D $Branch

Write-Host "✓ bot/ synced to Trench.meme.bot (main)" -ForegroundColor Green
