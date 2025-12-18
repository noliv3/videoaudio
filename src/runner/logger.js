const fs = require('fs');
const path = require('path');

class RunnerLogger {
  constructor(eventsPath) {
    this.eventsPath = eventsPath;
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  }

  log(event) {
    const payload = Object.assign({ timestamp: new Date().toISOString() }, event || {});
    fs.appendFileSync(this.eventsPath, JSON.stringify(payload) + '\n');
    return payload;
  }
}

module.exports = RunnerLogger;
