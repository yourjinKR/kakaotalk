$ErrorActionPreference = 'Stop'
$install = 'C:\Program Files (x86)\Kakao\KakaoTalk'
$out = Join-Path $PSScriptRoot 'packaged-ui-evidence.json'

# This reads only the installed program package, never a user profile or database.
# The observations produced here are ordinary local static inspection, not REA Evidence.
function Read-XmlSnapshot([string]$relative) {
    $path = Join-Path $install $relative
    $bytes = [IO.File]::ReadAllBytes($path)
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    $settings = [Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $stream = [IO.MemoryStream]::new($bytes, $false)
    $reader = [Xml.XmlReader]::Create($stream, $settings)
    $xml = [Xml.XmlDocument]::new()
    $xml.XmlResolver = $null
    try { $xml.Load($reader) } finally { $reader.Dispose(); $stream.Dispose() }
    return @{ path = $path; sha256 = $digest; bytes = $bytes.Length; xml = $xml; text = [Text.Encoding]::UTF8.GetString($bytes) }
}

$strings = Read-XmlSnapshot 'skin\default\resource\string_merge.xml'
$colors = Read-XmlSnapshot 'skin\v3\color\color.xml'
$images = Read-XmlSnapshot 'skin\default\image\Resource.xml'
$fonts = Read-XmlSnapshot 'skin\v3\font\font_ko.xml'
$selectedIds = @(
    'IDS_ADDFRIENDDLG_100001','IDS_ADDFRIENDDLG_100002','IDS_ADDFRIENDDLG_100005',
    'IDS_ADDFRIENDDLG_100007','IDS_ADDFRIENDDLG_100008','IDS_ADDFRIENDDLG_100011',
    'IDS_ADDFRIENDDLG_100012','IDS_ADDFRIENDDLG_100014','IDS_ADDFRIENDDLG_100015',
    'IDS_ADDFRIENDDLG_100020','IDS_ADDFRIENDDLG_100021','IDS_ADDFRIENDDLG_100022',
    'IDS_ADDFRIENDDLG_100024','IDS_ADDFRIENDDLG_100028','IDS_ADDFRIENDDLG_100030',
    'IDS_ADDFRIENDDLG_100031','IDS_ADDFRIENDDLG_100032','IDS_ADDFRIENDDLG_100033',
    'IDS_FRIENDMNGRLSTCTRL_100001','IDS_FRIENDMNGRLSTCTRL_100002',
    'IDS_FRIENDMNGRLSTCTRL_100007','IDS_FRIENDMNGRLSTCTRL_100008',
    'IDS_FRIENDMNGRLSTCTRL_100009','IDS_FRIENDMNGRLSTCTRL_100010',
    'IDS_FRIENDMNGRLSTCTRL_100013','IDS_FRIENDMNGRLSTCTRL_100015',
    'IDS_FRIENDMNGRLSTCTRL_100024','IDS_FRIENDMNGRLSTCTRL_100025',
    'IDS_FRIENDMNGRLSTCTRL_100028','IDS_FRIENDMNGRLSTCTRL_100029',
    'IDS_FRIENDMNGRLSTCTRL_100030','IDS_FRIENDMNGRLSTCTRL_100032',
    'IDS_FRIENDMNGRLSTCTRL_100054','IDS_FRIEND_INFO_MEMO',
    'IDS_FRIEND_INFO_MEMO_INPUT','IDS_FRIEND_INFO_MEMO_DESCRIPTION',
    'IDS_PROFILE_100002','IDS_PROFILE_100046','IDS_PROFILE_100090',
    'IDS_PROFILE_100091','IDS_PROFILE_100092','IDS_PROFILE_100093',
    'IDS_PROFILE_100094','IDS_PROFILE_100098',
    'IDS_CHATROOMLIST_100004','IDS_CHATROOMLIST_100005',
    'IDS_CHATROOMLIST_100006','IDS_CHATROOMLIST_100007',
    'IDS_CHATROOMLIST_100008','IDS_CHATROOMLIST_100010',
    'IDS_CHATROOMLIST_100011','IDS_CHATROOMLIST_100014',
    'IDS_CHATROOMLIST_100019','IDS_CHATROOMLIST_100031',
    'IDS_CHATROOMLIST_100032','IDS_CHATROOMLIST_100033',
    'IDS_CHATROOMLIST_100034','IDS_CHATROOMLIST_100035',
    'IDS_CHATROOMLIST_100036','IDS_CHATROOMLIST_100041',
    'IDS_CHATROOMLIST_100042','IDS_CHATROOMLIST_100043','IDS_CHATROOMLIST_100044',
    'IDS_CHATLOG_100010','IDS_CHATLOG_100011','IDS_CHATLOG_100056','IDS_CHATLOG_100058',
    'IDS_CHATLOG_SEARCH_100001','IDS_CHATLOG_SEARCH_100003','IDS_CHATLOG_SEARCH_100005',
    'IDS_CHATLOG_CONTEXTMENU_100011','IDS_CHATLOG_CONTEXTMENU_100012',
    'IDS_CHATLOG_CONTEXTMENU_100013','IDS_CHATROOM_MENU_100001',
    'IDS_CHATROOM_MENU_100016','IDS_CHATROOM_MENU_100018',
    'IDS_CHATROOM_MENU_100023','IDS_CHATROOM_MENU_100033',
    'IDS_CHATROOM_INFO_100002','IDS_CHATROOM_INFO_100017',
    'IDS_CHAT_INVITE_100001','IDS_CHAT_INVITE_100015',
    'IDS_CHATROOM_SETTING_MOUSE_OVER_MENU_DESC',
    'IDS_SETTINGVIEW_PRESENT_CHAT_MEMBER_WRITING_STATUS_DESCRIPTION'
)
$lines = $strings.text -split "`n"
$stringRows = foreach ($id in $selectedIds) {
    $node = $strings.xml.SelectSingleNode("/Items/String[@ID='$id']")
    if ($null -eq $node) { throw "Missing selected ID: $id" }
    $line = 0
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i].Contains('ID="' + $id + '"')) { $line = $i + 1; break }
    }
    [ordered]@{ id = $id; line = $line; ko = $node.SelectSingleNode('ko').InnerText; en = $node.SelectSingleNode('en').InnerText }
}
$colorRows = foreach ($node in $colors.xml.SelectNodes('/Items/Color')) {
    $id = $node.SelectSingleNode('ID').InnerText
    if ($id -in @('Y100','Y100H','Y100D','Y50','B85','B70','B40','B10','B3','B0','CHATBG01','BLUE500S')) {
        [ordered]@{ id = $id; hex = $node.SelectSingleNode('Data').InnerText }
    }
}
$imageRows = foreach ($node in $images.xml.SelectNodes('/resource/group_image')) {
    if ($node.id -in @('chatroom_menu_favorite','chatroom_menu_favorite_off','chatroom_menu_pin','chatroom_menu_pin_off','chatroom_menu_alarm','chatroom_menu_alarm_off','chatroom_menu_icon_exit','chatroom_menu_icon_invite')) {
        [ordered]@{ id = [string]$node.id; states = @($node.SelectNodes('piece') | ForEach-Object { [string]$_.state }) }
    }
}
$opaqueRows = foreach ($name in @('OnlineMainView.xml','FriendListView.xml','ContactListItemFriend.xml','ChatRoomListItem.xml','ChatLogViewItem_MsgLeft.xml','ChatLogViewItem_MsgRight.xml','AddFriendDlg.xml','AddFriendByUUIDView.xml')) {
    $path = Join-Path $install ('skin\default\layout\' + $name)
    $bytes = [IO.File]::ReadAllBytes($path)
    $xmlParsed = $false
    try {
        $snapshot = Read-XmlSnapshot ('skin\default\layout\' + $name)
        $xmlParsed = $true
    } catch [Xml.XmlException] { }
    [ordered]@{ path = $path; bytes = $bytes.Length; sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant(); first16Hex = [Convert]::ToHexString($bytes[0..15]); parsedAsXml = $xmlParsed; conclusion = 'Opaque bytes under an XML filename; no layout geometry or behavior inferred.' }
}
$exe = Get-Item -LiteralPath (Join-Path $install 'KakaoTalk.exe')
$result = [ordered]@{
    record_type = 'Supplemental local static package observations; not REA Evidence'
    observation_id = 'local-kakaotalk-package-ui-20261022'
    observed_date = '2026-10-22'
    method = 'Read selected installed package files; parse XML with DTD prohibited and XmlResolver disabled; hash exact input bytes.'
    executable = [ordered]@{ path = $exe.FullName; file_version = $exe.VersionInfo.FileVersion; product_version = $exe.VersionInfo.ProductVersion; bytes = $exe.Length; sha256 = (Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    sources = @(@{name='strings';snapshot=$strings},@{name='colors';snapshot=$colors},@{name='image_states';snapshot=$images},@{name='fonts';snapshot=$fonts}) | ForEach-Object { [ordered]@{ name=$_.name; path=$_.snapshot.path; sha256=$_.snapshot.sha256; bytes=$_.snapshot.bytes } }
    total_string_records = $strings.xml.SelectNodes('/Items/String').Count
    selected_strings = @($stringRows)
    selected_colors = @($colorRows)
    selected_image_group_states = @($imageRows)
    selected_font_aliases = @($fonts.xml.SelectNodes('/resource/user_font') | Select-Object -First 8 | ForEach-Object { [ordered]@{ id = [string]$_.id; font_id = [string]$_.font_id } })
    layout_probe = @($opaqueRows)
    limitations = @('String presence and resource state declarations do not prove code reachability or current runtime behavior.','The selected layouts are not parseable plain XML; encryption/compression/serialization has not been determined.','No native pseudocode, protocol, backend, private database, authentication state, or runtime scenario was inspected.','Asset payloads and layout source were not copied into the reconstructed app.','The inventory is scoped to selected friend/chat UI records; it is not a complete feature inventory.')
}
$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $out -Encoding utf8
Write-Output ("Saved {0} selected strings and {1} opaque layout probes to {2}" -f $stringRows.Count,$opaqueRows.Count,$out)
