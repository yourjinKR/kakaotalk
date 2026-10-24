param(
  [string]$InstallRoot = 'C:\Program Files (x86)\Kakao\KakaoTalk',
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../docs/research/evidence')
)

$ErrorActionPreference = 'Stop'
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$selectedPaths = @(
  'KakaoTalk.exe',
  'skin/default/resource/string_merge.xml',
  'skin/default/font/font_ko.xml',
  'skin/v3/font/font_ko.xml',
  'skin/v3/color/color.xml',
  'skin/default/layout/MainView.xml',
  'skin/default/layout/FriendListView.xml',
  'skin/default/layout/FriendListSearchView.xml',
  'skin/default/layout/FriendManageListItem.xml',
  'skin/default/layout/FriendManageBlockListItem.xml',
  'skin/default/layout/AddFriendDlg.xml',
  'skin/default/layout/addFriendByPhoneNumberView.xml',
  'skin/default/layout/AddFriendByUUIDView.xml',
  'skin/default/layout/ChatRoomListView.xml',
  'skin/default/layout/ChatRoomListItem.xml',
  'skin/default/layout/ChatDlg_EX.xml',
  'skin/default/layout/ChatLogViewItem_MsgLeft.xml',
  'skin/default/layout/ChatLogViewItem_MsgRight.xml',
  'skin/default/layout/ChatLogBalloon_Left.xml',
  'skin/default/layout/ChatLogBalloon_Right.xml',
  'skin/default/layout/ChatLogContentTextMessage.xml',
  'skin/default/layout/ChatLogContentDayBreak.xml'
)

$identities = foreach ($relativePath in $selectedPaths) {
  $sourcePath = Join-Path $InstallRoot $relativePath
  $file = Get-Item -LiteralPath $sourcePath
  $stream = [IO.File]::OpenRead($sourcePath)
  try {
    $prefix = New-Object byte[] 32
    $prefixLength = $stream.Read($prefix, 0, $prefix.Length)
  } finally { $stream.Dispose() }
  [pscustomobject]@{
    path = $file.FullName
    relative_path = $relativePath
    size_bytes = $file.Length
    last_write_time_utc = $file.LastWriteTimeUtc.ToString('o')
    sha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    first_32_bytes_hex = [Convert]::ToHexString($prefix[0..($prefixLength-1)]).ToLowerInvariant()
    file_version = if ($file.Extension -eq '.exe') { $file.VersionInfo.FileVersion } else { $null }
  }
}
$identities | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'artifact-identities.json') -Encoding utf8

$sourceStringPath = Join-Path $InstallRoot 'skin/default/resource/string_merge.xml'
$lines = Get-Content -LiteralPath $sourceStringPath
$stringId = $null
$selectedStrings = for ($index = 0; $index -lt $lines.Count; $index++) {
  if ($lines[$index] -match '<String ID="([^"]+)"') { $stringId = $Matches[1] }
  if ($lines[$index] -notmatch '<ko>(.*)</ko>') { continue }
  $koreanText = $Matches[1]
  if ($stringId -match '^IDS_(CONTACT|CHATROOMLIST|ADDFRIENDDLG|FRIEND|CHATLOG_CONTEXTMENU|RENAME_FRIEND|RENAME_ME|RENAME_CHATROOM|SHORTCUT_NEW_CHAT|SHORTCUT_ADD_FRIEND|SHORTCUT_SEARCH)' -or
      $koreanText -match '숨긴 친구|차단하면 차단한|차단친구와는|차단한 친구에게는|줄바꿈|Enter.*전송|전송.*Enter|친구 이름|이름 변경|친구 카카오톡 ID|연락처로 추가|숨김 친구|차단 친구|친구 관리|친구 등록이 완료|숨김 설정된|차단 해제 후|답장 입력|전송실패|전송중|나와의 채팅|최대.*명|삭제된 메시지') {
    [pscustomobject]@{
      source_path = $sourceStringPath
      line = $index + 1
      string_id = $stringId
      ko = [System.Net.WebUtility]::HtmlDecode($koreanText)
    }
  }
}
$selectedStrings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'selected-korean-strings.json') -Encoding utf8

$colorPath = Join-Path $InstallRoot 'skin/v3/color/color.xml'
[xml]$colors = Get-Content -LiteralPath $colorPath -Raw
$colors.Items.Color | ForEach-Object { [pscustomobject]@{id=$_.ID;hex=$_.Data} } |
  ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'color-tokens.json') -Encoding utf8

[pscustomobject]@{
  evidence_kind = 'ordinary-shell-static-resource-observation'
  collected_at_utc = [DateTime]::UtcNow.ToString('o')
  install_root = $InstallRoot
  source_boundary = 'Selected installed program files only; no AppData, account stores, private databases, live process or network traffic'
  copied_assets = $false
  identity_count = @($identities).Count
  selected_string_count = @($selectedStrings).Count
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'collection-manifest.json') -Encoding utf8

Write-Output "Saved $(@($identities).Count) file identities and $(@($selectedStrings).Count) focused strings to $resolvedOutput"
