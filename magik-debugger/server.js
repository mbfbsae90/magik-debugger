'use strict';

const SlapProtocol = require('./SlapProtocol');
const net = require('net');

const PORT = process.env.PORT || 4123;

var Promise = require('bluebird');

const ws = require('ws');
const http = require('http');
const url = require('url');
const fs = Promise.promisifyAll(require('fs'));

const allowedPaths = {
  '/': {
    contentType: 'text/html',
    pathName: 'index.html',
  },
  '/magik-debug.js': {
    contentType: 'application/javascript',
    pathName: 'magik-debug.js',
  },
  '/styles.css': {
    contentType: 'text/css',
    pathName: 'styles.css',
  },
};

const server = http.createServer(Promise.coroutine(function *(req, res)  {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }

  const reqUrl = url.parse(req.url);
  const path = allowedPaths[reqUrl.pathname];
  if (path) {
    const filePath = __dirname + '/web/' + path.pathName;
    const stat = yield fs.statAsync(filePath);
    res.writeHead(200, {
      'Content-Type': path.contentType,
      'Content-Length': stat.size,
    });

    fs.createReadStream(filePath).pipe(res);
  } else {
    res.statusCode = 404;
    res.end('File not found');
  }
}));

const wss = new ws.Server({server, perMessageDeflate: false});

const socket = new net.Socket();
const slapConn = new SlapProtocol(socket, true);

const remoteHost = process.argv[2].split(':');
socket.connect(+remoteHost[1], remoteHost[0]);

wss.on('connection', ws => {
  ws.on('message', m => {
    const parsed = JSON.parse(m);

    slapConn[parsed.command](...parsed.args).then(response => {
      ws.send(JSON.stringify(
        Object.assign(response || {}, {requestId: parsed.requestId})));
    }).catch(e => {
      ws.send(JSON.stringify({
        requestId: parsed.requestId,
        error: `${e.message} running ${parsed.command}`,
      }));
    });
  });

  const breakpointHandlerID = slapConn.addBreakpointHandler(e => {
    ws.send(JSON.stringify({breakpoint: e}));
  });
  const threadEventHandlerID = slapConn.addThreadEventHandler(e => {
    ws.send(JSON.stringify({threadEvent: e}));
  });

  ws.on('close', () => {
    slapConn.removeBreakpointHandler(breakpointHandlerID);
    slapConn.removeThreadEventHandler(threadEventHandlerID);
  });
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
