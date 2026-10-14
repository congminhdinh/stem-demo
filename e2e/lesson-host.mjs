import { createServer } from 'node:http';
import { argv } from 'node:process';
import { URL } from 'node:url';

// E2E only (S1): a stand-in for a lesson page of Student Web or the CMS,
// another site that frames the lab. Like those pages, it sends no COOP/COEP
// headers. It is a real server on loopback, not a routed response: Chromium
// treats a routed page as public, and Local Network Access then refuses to
// frame localhost (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS).
//
//   GET /lesson?lab=<lab URL>[&sandbox=<iframe sandbox tokens>]

const port = Number(argv[2] ?? 5190);

const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://lesson.localhost');
  const lab = url.searchParams.get('lab') ?? '';
  const sandbox = url.searchParams.get('sandbox');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Lesson</title></head>
  <body style="margin: 0">
    <p>Lesson</p>
    <iframe title="Lab" src="${escapeHtml(lab)}" width="1100" height="640"${
      sandbox === null ? '' : ` sandbox="${escapeHtml(sandbox)}"`
    }></iframe>
  </body>
</html>
`);
}).listen(port);
