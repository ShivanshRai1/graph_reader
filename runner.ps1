$api = 'https://graph-reader-0ot9.onrender.com/api/ai-extraction'
$img = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2jQAAAAASUVORK5CYII='
Write-Output 'CASE3_REPEAT_TEST_START'
for($i=1;$i -le 3;$i++){
  $id = [guid]::NewGuid().ToString()
  $payload = @{
    action='graphcapture'
    type='ai_extraction'
    ai_extraction_id=([guid]::NewGuid().ToString())
    base64image=$img
    graph_id=''
    discoveree_cat_id='0'
    partno='nvmts0d4n04cl'
    manf='onsemi'
    manufacturer='onsemi'
    username=''
    graph_title='RDS(on)-ID'
    curve_title='Mosfets'
    x_label=''
    y_label=''
    other_symbols=''
    identifier=$id
    testuser_id=''
    tctj='25'
    return_url=''
  } | ConvertTo-Json
  try {
    $resp = Invoke-WebRequest -Uri $api -Method POST -Body $payload -ContentType 'application/json' -UseBasicParsing
    $obj = $resp.Content | ConvertFrom-Json
    $returned = ''
    if($obj.response -and $obj.response.graph_id){ $returned = [string]$obj.response.graph_id }
    Write-Output ("TRY=" + $i + "; IDENTIFIER=" + $id + "; HTTP=" + $resp.StatusCode + "; UPSTREAM_OK=" + $obj.upstream_ok + "; RETURNED_GRAPH_ID=" + $returned)
  } catch {
    Write-Output ("TRY=" + $i + "; IDENTIFIER=" + $id + "; ERROR=" + $_.Exception.Message)
  }
}
Write-Output 'CASE3_REPEAT_TEST_END'
Write-Output 'CASE2_DEMO_DETAILS_CHECK_START'
$g='16439'
try {
  $r = Invoke-WebRequest -Uri ("https://www.discoveree.io/graph_capture_api.php?graph_id=" + $g) -UseBasicParsing
  $o = $r.Content | ConvertFrom-Json
  $dcount = 0
  if($o.details -is [array]){ $dcount = $o.details.Count } elseif($o.graph -and $o.graph.details -is [array]){ $dcount = $o.graph.details.Count }
  Write-Output ("GRAPH_ID="+$g+"; STATUS="+[string]$o.status+"; DETAILS_COUNT="+$dcount)
} catch {
  Write-Output ("GRAPH_ID="+$g+"; ERROR=" + $_.Exception.Message)
}
Write-Output 'CASE2_DEMO_DETAILS_CHECK_END'
