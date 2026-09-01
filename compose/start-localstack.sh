#!/bin/bash
export AWS_REGION=eu-west-2
export AWS_DEFAULT_REGION=eu-west-2
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

# S3 buckets
aws --endpoint-url=http://localhost:4566 s3 mb s3://bng-metric-backend-localstack
aws --endpoint-url=http://localhost:4566 s3 mb s3://baseline-files
aws --endpoint-url=http://localhost:4566 s3 mb s3://cdp-uploader-quarantine

# Report fonts (BMD-984). Deliberately left EMPTY: the typeface this bucket
# exists for — GDS Transport — is licensed to GDS under a bilateral agreement
# and cannot be committed to a public repository, which is the whole reason the
# service reads it from a bucket rather than from `assets/fonts`. Leave
# REPORT_FONT_BUCKET unset and the report embeds the committed Noto Sans. To
# exercise the S3 path locally, copy your own licensed files in and set it:
#   aws --endpoint-url=http://localhost:4566 s3 cp <font>.ttf s3://bng-metric-report-fonts/
aws --endpoint-url=http://localhost:4566 s3 mb s3://bng-metric-report-fonts

# CDP Uploader SQS queues
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name cdp-clamav-results
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name cdp-uploader-scan-results-callback.fifo --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"true"}'
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name mock-clamav
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name cdp-uploader-download-requests

# Wire up mock virus scanner — notify mock-clamav queue when files land in quarantine bucket
aws --endpoint-url=http://localhost:4566 s3api put-bucket-notification-configuration --bucket cdp-uploader-quarantine --notification-configuration '{"QueueConfigurations": [{"QueueArn": "arn:aws:sqs:eu-west-2:000000000000:mock-clamav","Events": ["s3:ObjectCreated:*"]}]}'
