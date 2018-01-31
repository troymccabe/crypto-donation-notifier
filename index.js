/**
 * Crypto donation chat notifier
 * 
 * Notify chat (currently Slack & Discord) participants of deposits to a crypto address
 * 
 * @author Troy McCabe <troymccabe@gmail.com>
 */

 /**
  * Gets transactions within the time period from CryptoID
  */
function getDonationsFromCryptoID(currency, addressId, notify, intervalSeconds) {
    var https = require('https');
    https.get(
        `https://chainz.cryptoid.info/explorer/address.summary.dws?coin=${currency}&id=${addressId}&all=1fmt.js`, 
        (res) => {
            var json = '';
            res.on('data', function(chunk) {
                json += chunk;
            });
            res.on('end', function() {
                /* Response format from CryptoID
                * {
                *     "block": <current block:int>,
                *     "stake": <staking:int>,
                *     "stakenb": <?:int>,
                *     "received": <total received:long>,
                *     "receivednb": <?:int>,
                *     "sent": <total sent:int>,
                *     "sentnb": <?:int>,
                *     "stakeIn": <?:int>,
                *     "stakeOut": <?:int>,
                *     "balance": <address balance:long>,
                *     "tx": [
                *         <cryptoID txid:int>, 
                *         <txid:string>, 
                *         <block:int>, 
                *         <0=unixtimestamp|>0=+delta:int>, 
                *         <amount:float>, 
                *         <balance:float>
                *     ]
                * }
                */
                var resp = JSON.parse(json);
                var timeBetweenRuns = Math.floor(Date.now() / 1000) - intervalSeconds;
                var txTimestamp, msg;

                for (var i = 0; i < resp.tx.length; i++) {
                    // if it's the first transaction, it's got the full timestamp
                    // subsequent transactions are additional seconds added to that initial timestamp
                    // this is the way cryptoid does it, for whatever reason
                    txTimestamp = i == 0 ? resp.tx[i][3] : txTimestamp + resp.tx[i][3];

                    // the transaction occurred between the last run and now
                    if (txTimestamp > timeBetweenRuns) {
                        notify(
                            `New ${currency.toUpperCase()} donation of ${resp.tx[i][4]} ${currency.toUpperCase()}! ` +
                            `The wallet now has a balance of ${resp.tx[i][5]} ${currency.toUpperCase()}.` +
                            `\nView the tx here: https://chainz.cryptoid.info/${currency}/tx.dws?${resp.tx[i][0]}.htm`, 
                            i
                        );
                    }
                }
            });
        }).on('error', (e) => {
            console.error(`[ERROR] CRYPTOID REQUEST FAILED: ${e.message}`);
        });
}

/**
 * Handler for Lambda
 */
exports.handler = function(event, context, callback) {
    // only init slack if set up
    if (process.env.SLACK_WEBHOOK_URL && process.env.SLACK_CHANNEL) {
        const { IncomingWebhook, WebClient } = require('@slack/client');
        const slackClient = new IncomingWebhook(
            process.env.SLACK_WEBHOOK_URL,
            {channel: process.env.SLACK_CHANNEL}
        );
    } else {
        const slackClient = null;
    }

    // only init discord if set up
    if (process.env.DISCORD_ID && process.env.DISCORD_TOKEN) {
        const Discord = require('discord.js');
        const discordClient = new Discord.WebhookClient(process.env.DISCORD_ID, process.env.DISCORD_TOKEN);
    } else {
        const discordClient = null;
    }

    // Set up the callback so it can be called in each iteration, helps with the slack nonsense
    var notify = function(message, iteration) {
        if (slackClient) {
            // Delay Slack messages so they appear in order 
            // if we just called `send`, they'd hit Slack in random orders
            // pausing it 500ms (arbitrary) more for each iteration worked
            setTimeout(function() {
                slackClient.send(message, (error, resp) => {
                    error ? console.error(`[ERROR] SLACK: ${error}`) : console.log('SLACK: NOTIFICATION SENT');
                });
            }, 500 * iteration);
        }

        if (discordClient) {
            discordClient.send(message)
                .then(message => console.log('DISCORD: NOTIFICATION SENT'))
                .catch(error => console.error(`[ERROR] DISCORD: ${error}`));
        }
    }

    getDonationsFromCryptoID('ecc', '516674', notify, process.env.CHECK_INTERVAL || 60);
};
