# crypto-donation-chat-notifier
Notify chat participants of crypto donations

## Support
### Block explorers
Currently, this monitors just CryptoID for a specific ECC address

### Chat clients
Slack & Discord are currently supported

## Setup
To enable Slack notifications, you need the following env vars:

`SLACK_WEBHOOK_URL`: The Webhook URL of this integration

`SLACK_CHANNEL`: The channel to post notices to (e.g. `#donate`)

To enable Discord notifications, you need the following env vars:

`DISCORD_ID`: The ID of this webhook

`DISCORD_TOKEN`: The token of this webhook

To change the interval that this handler considers donations "new" 
(e.g. if a donation occurred in the last `X` seconds), you can set:

`CHECK_INTERVAL`: # of seconds ago to consider a transaction new
