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
                var txTimestamp;

                for (var i = 0; i < resp.tx.length; i++) {
                    // if it's the first transaction, it's got the full timestamp
                    // subsequent transactions are additional seconds added to that initial timestamp
                    // this is the way cryptoid does it, for whatever reason
                    txTimestamp = i == 0 ? resp.tx[i][3] : txTimestamp + resp.tx[i][3];

                    // the transaction occurred between the last run and now
                    // and amount is > 0
                    if (txTimestamp > timeBetweenRuns && resp.tx[i][4] > 0) {
                        notify(
                            currency.toUpperCase(), 
                            resp.tx[i][1],
                            resp.tx[i][4], 
                            resp.tx[i][5],
                            `https://chainz.cryptoid.info/${currency}/tx.dws?${resp.tx[i][1]}.htm`,
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
  * Gets transactions within the time period from CryptoID
  */
function getDonationsFromBlockExplorer(currency, address, notify, intervalSeconds) {
    var domain = `${currency == 'bch' ? 'bitcoincash.' : ''}blockexplorer.com`;
    var https = require('https');
    https.get(
        `https://${domain}/api/addrs/${address}/txs`, 
        (res) => {
            var json = '';
            res.on('data', function(chunk) {
                json += chunk;
            });
            res.on('end', function() {
                var resp = JSON.parse(json);
                var timeBetweenRuns = Math.floor(Date.now() / 1000) - intervalSeconds;
                var tx, vout;

                tx:
                for (var i = 0; i < resp.items.length; i++) {
                    tx = resp.items[i];

                    // the transaction occurred between the last run and now
                    if (tx.blocktime && tx.blocktime > timeBetweenRuns) {
                        for (var j = 0; j < tx.vout.length; j++) {
                            vout = tx.vout[j];

                            for (var k = 0; k < vout.scriptPubKey.addresses.length; k++) {
                                if (vout.scriptPubKey.addresses[k] == address) {
                                    https.get(
                                        `https://${domain}/api/addr/${address}/balance`, 
                                        (res) => {
                                            var balance = '';
                                            res.on('data', function(chunk) {
                                                balance += chunk;
                                            });
                                            res.on('end', function() {
                                                notify(
                                                    currency.toUpperCase(),
                                                    tx.txid,
                                                    vout.value,
                                                    balance * 1e-8,
                                                    `https://${domain}/tx/${tx.txid}`,
                                                    i
                                                );
                                            });
                                    }).on('error', (e) => {
                                        console.error(`[ERROR] BLOCKEXPLORER REQUEST 1 FAILED: ${e.message}`);
                                    });

                                    continue tx;
                                }
                            }
                        }

                    }
                }
            });
    }).on('error', (e) => {
        console.error(`[ERROR] BLOCKEXPLORER REQUEST 0 FAILED: ${e.message}`);
    });
}

/**
 * Handler for Lambda
 */
exports.handler = function(event, context, callback) {
    // only init slack if set up
    var slackClient;
    if (process.env.SLACK_WEBHOOK_URL && process.env.SLACK_CHANNEL) {
        const { IncomingWebhook, WebClient } = require('@slack/client');
        slackClient = new IncomingWebhook(
            process.env.SLACK_WEBHOOK_URL,
            {channel: process.env.SLACK_CHANNEL}
        );
    }

    // only init discord if set up
    var discordClient
    if (process.env.DISCORD_ID && process.env.DISCORD_TOKEN) {
        const Discord = require('discord.js');
        discordClient = new Discord.WebhookClient(process.env.DISCORD_ID, process.env.DISCORD_TOKEN);
    }

    const S3 = require('aws-sdk/clients/s3');
    var s3 = new S3({
        apiVersion: '2006-03-01',
        region: 'us-west-1'
    });

    // Set up the callback so it can be called in each iteration, helps with the slack nonsense
    var notify = function(currency, tx, donation, balance, url, iteration) {
        var s3Opts = {'Bucket': 'ecc-donation-notifications', 'Key': `${currency}/${tx}`};
        s3.headObject(
            s3Opts,
            function (error, data) {
                if (error) {
                    var message = `New ${currency} donation of ${donation} ${currency}! ` +
                    `The wallet now has a balance of ${balance} ${currency}.` +
                    `\nView the tx here: ${url}`;
        
                    /* global slackClient */
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
            
                    /* global discordClient */
                    if (discordClient) {
                        discordClient.send(message)
                            .then(message => console.log('DISCORD: NOTIFICATION SENT'))
                            .catch(error => console.error(`[ERROR] DISCORD: ${error}`));
                    }

                    s3.putObject(s3Opts, function(error, data) {});
                }
            }
        )
    }

    var checkInterval = process.env.CHECK_INTERVAL || 60;
    getDonationsFromCryptoID('ecc', '516674', notify, checkInterval);
    getDonationsFromCryptoID('ltc', '24758298', notify, checkInterval);
    getDonationsFromBlockExplorer('bch', '1LC8zhYNXgRQ5d6sCTxDrC8wBq6D1gdQDZ', notify, checkInterval);
    getDonationsFromBlockExplorer('btc', '1LC8zhYNXgRQ5d6sCTxDrC8wBq6D1gdQDZ', notify, checkInterval);
};