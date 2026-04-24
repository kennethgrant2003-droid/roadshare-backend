$BASE = "http://127.0.0.1:3000"

Write-Host "=== ROAD SHARE DEMO START ===" -ForegroundColor Cyan

# ----------------------------------
# 1) HELPER LOGIN
# ----------------------------------
Write-Host "Logging in helper..." -ForegroundColor Yellow

$sendH = Invoke-RestMethod -Method POST `
  -Uri "$BASE/auth/send-code" `
  -ContentType "application/json" `
  -Body (@{ phone = "404-555-1234" } | ConvertTo-Json)

$verifyH = Invoke-RestMethod -Method POST `
  -Uri "$BASE/auth/verify" `
  -ContentType "application/json" `
  -Body (@{
    phone = "404-555-1234"
    code  = "$($sendH.devCode)"
    role  = "helper"
  } | ConvertTo-Json)

$HTOKEN = $verifyH.token
$HELPER_ID = $verifyH.user.id

Write-Host "Helper logged in: $HELPER_ID" -ForegroundColor Green

# ----------------------------------
# 2) HELPER GOES ONLINE
# ----------------------------------
Write-Host "Setting helper online..." -ForegroundColor Yellow

$online = Invoke-RestMethod -Method POST `
  -Uri "$BASE/helper/go-online" `
  -Headers @{ Authorization = "Bearer $HTOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    latitude = 33.7490
    longitude = -84.3880
    maxRadiusMiles = 15
  } | ConvertTo-Json)

Write-Host "Helper is online." -ForegroundColor Green

# ----------------------------------
# 3) CUSTOMER LOGIN
# ----------------------------------
Write-Host "Logging in customer..." -ForegroundColor Yellow

$sendC = Invoke-RestMethod -Method POST `
  -Uri "$BASE/auth/send-code" `
  -ContentType "application/json" `
  -Body (@{ phone = "404-555-9999" } | ConvertTo-Json)

$verifyC = Invoke-RestMethod -Method POST `
  -Uri "$BASE/auth/verify" `
  -ContentType "application/json" `
  -Body (@{
    phone = "404-555-9999"
    code  = "$($sendC.devCode)"
    role  = "customer"
  } | ConvertTo-Json)

$CTOKEN = $verifyC.token
$CUSTOMER_ID = $verifyC.user.id

Write-Host "Customer logged in: $CUSTOMER_ID" -ForegroundColor Green

# ----------------------------------
# 4) CUSTOMER CREATES JOB
# ----------------------------------
Write-Host "Creating roadside job..." -ForegroundColor Yellow

$create = Invoke-RestMethod -Method POST `
  -Uri "$BASE/jobs/create" `
  -Headers @{ Authorization = "Bearer $CTOKEN" } `
  -ContentType "application/json" `
  -Body (@{
    serviceType = "jump_start"
    pickupLat   = 33.7490
    pickupLng   = -84.3880
  } | ConvertTo-Json)

$JOBID = $create.job.id

Write-Host "Job created: $JOBID" -ForegroundColor Green
Write-Host "Nearby helpers found: $($create.nearbyHelpers.Count)" -ForegroundColor Green

# ----------------------------------
# 5) HELPER ACCEPTS JOB
# ----------------------------------
Write-Host "Helper accepting job..." -ForegroundColor Yellow

$accept = Invoke-RestMethod -Method POST `
  -Uri "$BASE/jobs/$JOBID/accept" `
  -Headers @{ Authorization = "Bearer $HTOKEN" } `
  -ContentType "application/json" `
  -Body (@{} | ConvertTo-Json)

Write-Host "Job accepted. Status: $($accept.job.status)" -ForegroundColor Green

# ----------------------------------
# 6) HELPER STATUS = EN_ROUTE
# ----------------------------------
Write-Host "Updating status to en_route..." -ForegroundColor Yellow

$enRoute = Invoke-RestMethod -Method POST `
  -Uri "$BASE/jobs/$JOBID/status" `
  -Headers @{ Authorization = "Bearer $HTOKEN" } `
  -ContentType "application/json" `
  -Body (@{ status = "en_route" } | ConvertTo-Json)

Write-Host "Status now: $($enRoute.job.status)" -ForegroundColor Green

Start-Sleep -Seconds 1

# ----------------------------------
# 7) HELPER STATUS = ARRIVED
# ----------------------------------
Write-Host "Updating status to arrived..." -ForegroundColor Yellow

$arrived = Invoke-RestMethod -Method POST `
  -Uri "$BASE/jobs/$JOBID/status" `
  -Headers @{ Authorization = "Bearer $HTOKEN" } `
  -ContentType "application/json" `
  -Body (@{ status = "arrived" } | ConvertTo-Json)

Write-Host "Status now: $($arrived.job.status)" -ForegroundColor Green

Start-Sleep -Seconds 1

# ----------------------------------
# 8) HELPER STATUS = COMPLETED
# ----------------------------------
Write-Host "Updating status to completed..." -ForegroundColor Yellow

$completed = Invoke-RestMethod -Method POST `
  -Uri "$BASE/jobs/$JOBID/status" `
  -Headers @{ Authorization = "Bearer $HTOKEN" } `
  -ContentType "application/json" `
  -Body (@{ status = "completed" } | ConvertTo-Json)

Write-Host "Status now: $($completed.job.status)" -ForegroundColor Green

# ----------------------------------
# 9) FINAL JOB CHECK
# ----------------------------------
Write-Host "Fetching final job..." -ForegroundColor Yellow

$finalJob = Invoke-RestMethod -Method GET `
  -Uri "$BASE/jobs/$JOBID" `
  -Headers @{ Authorization = "Bearer $CTOKEN" }

Write-Host "=== FINAL JOB ===" -ForegroundColor Cyan
$finalJob.job | Format-List *

Write-Host "=== ROAD SHARE DEMO COMPLETE ===" -ForegroundColor Cyan