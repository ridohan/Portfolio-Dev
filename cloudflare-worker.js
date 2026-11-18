export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // OpenFIGI — POST /openfigi/v3/mapping
    if (url.pathname.startsWith('/openfigi/')) {
      const target = 'https://api.openfigi.com' + url.pathname.replace('/openfigi', '') + url.search;
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await request.text(),
      });
      return new Response(await res.text(), {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // JustETF — tout le reste (comportement existant)
    const target = 'https://www.justetf.com' + url.pathname + url.search;
    const res = await fetch(target, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
