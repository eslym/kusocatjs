const key = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString('base64');
console.log(`\nAdd this to your .env file:\nAPP_KEY=${key}\n`);
