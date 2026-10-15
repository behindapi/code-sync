import React, { useEffect, useRef, useState } from 'react';

const SANDBOX_DOCUMENT = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<script>
(() => {
  let activeWorker = null;
  const runnerWorker = function () {
    self.onmessage = function ({ data }) {
      const outputLimit = 12000;
      let outputLength = 0;
      let finished = false;
      const send = function (type, value) {
        if (finished && type !== 'output-limit') return;
        const text = String(value).slice(0, 2000);
        const remaining = outputLimit - outputLength;
        if (type === 'log' || type === 'error') {
          if (remaining <= 0) {
            postMessage({ type: 'output-limit' });
            finished = true;
            return;
          }
          outputLength += Math.min(text.length, remaining);
          postMessage({ type: type, text: text.slice(0, remaining) });
        } else {
          postMessage({ type: type, text: text });
        }
      };
      const stringify = function (value) {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch (_error) { return String(value); }
      };
      self.console = Object.fromEntries(['log', 'info', 'warn', 'error'].map(function (level) {
        return [level, function () {
          const args = Array.from(arguments);
          send(level === 'error' ? 'error' : 'log', args.map(stringify).join(' '));
        }];
      }));
      self.onerror = function (_message, _source, _line, _column, error) {
        send('error', error && error.stack ? error.stack : 'The program stopped with an error.');
      };
      self.onunhandledrejection = function (event) {
        send('error', event.reason && event.reason.stack ? event.reason.stack : String(event.reason));
      };
      const sourceUrl = URL.createObjectURL(new Blob([data.code], { type: 'text/javascript' }));
      try {
        importScripts(sourceUrl);
        send('done', 'Execution finished.');
        finished = true;
      } catch (error) {
        send('error', error && error.stack ? error.stack : String(error));
        send('done', 'Execution finished with an error.');
        finished = true;
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }
    };
  };
  const workerUrl = URL.createObjectURL(new Blob(['(' + runnerWorker.toString() + ')()'], { type: 'text/javascript' }));
  window.addEventListener('message', (event) => {
    if (event.source !== parent || !event.data) return;
    if (event.data.type === 'cancel') {
      if (activeWorker) activeWorker.terminate();
      activeWorker = null;
      return;
    }
    if (event.data.type !== 'run' || !event.ports[0]) return;
    if (activeWorker) activeWorker.terminate();
    const resultPort = event.ports[0];
    activeWorker = new Worker(workerUrl);
    activeWorker.onmessage = (messageEvent) => {
      resultPort.postMessage(messageEvent.data);
      if (messageEvent.data.type === 'done' || messageEvent.data.type === 'output-limit') activeWorker.terminate();
    };
    activeWorker.onerror = () => {
      resultPort.postMessage({ type: 'error', text: 'The isolated runner could not start this program.' });
      resultPort.postMessage({ type: 'done', text: 'Execution stopped.' });
    };
    activeWorker.postMessage({ code: event.data.code });
  });
})();
</script>`;

const SandboxRunner = ({ request, onOutput, timeoutMs = 2500 }) => {
    const frameRef = useRef(null);
    const timeoutRef = useRef(null);
    const [frameReady, setFrameReady] = useState(false);

    useEffect(() => {
        if (!request || !frameReady || !frameRef.current) return undefined;
        const channel = new MessageChannel();
        let ended = false;
        const output = [];
        onOutput({ status: 'running', lines: [] });
        channel.port1.onmessage = (event) => {
            if (ended) return;
            const { type, text } = event.data || {};
            if (type === 'log' || type === 'error') {
                output.push({ type, text: String(text || '').slice(0, 2000) });
                const total = output.reduce((sum, line) => sum + line.text.length, 0);
                if (total >= 12000) {
                    output.push({ type: 'note', text: 'Output limit reached.' });
                    onOutput({ status: 'complete', lines: output.slice(0, 60) });
                    ended = true;
                    clearTimeout(timeoutRef.current);
                    frameRef.current.contentWindow.postMessage({ type: 'cancel' }, '*');
                } else {
                    onOutput({ status: 'running', lines: output.slice(0, 60) });
                }
            } else if (type === 'done' && !ended) {
                ended = true;
                clearTimeout(timeoutRef.current);
                onOutput({ status: 'complete', lines: output.length ? output.slice(0, 60) : [{ type: 'note', text: text || 'Execution finished with no output.' }] });
            } else if (type === 'output-limit' && !ended) {
                ended = true;
                clearTimeout(timeoutRef.current);
                output.push({ type: 'note', text: 'Output limit reached.' });
                onOutput({ status: 'complete', lines: output.slice(0, 60) });
            }
        };
        channel.port1.start();
        timeoutRef.current = setTimeout(() => {
            if (ended) return;
            ended = true;
            channel.port1.close();
            onOutput({ status: 'timeout', lines: [{ type: 'error', text: 'Stopped after 2.5 seconds. Check for a long-running loop.' }] });
            frameRef.current.contentWindow.postMessage({ type: 'cancel' }, '*');
        }, timeoutMs);
        frameRef.current.contentWindow.postMessage({ type: 'run', code: request.code }, '*', [channel.port2]);

        return () => {
            clearTimeout(timeoutRef.current);
            channel.port1.close();
        };
    }, [request, frameReady, onOutput, timeoutMs]);

    return (
        <iframe
            ref={frameRef}
            className="sandbox-frame"
            title="Isolated JavaScript runner"
            sandbox="allow-scripts"
            srcDoc={SANDBOX_DOCUMENT}
            onLoad={() => setFrameReady(true)}
            aria-hidden="true"
            tabIndex={-1}
        />
    );
};

export default SandboxRunner;
