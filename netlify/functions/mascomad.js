const LISTING_URL = 'https://www.mascomad.org/Animales/ListAnimales';
const API_URL     = 'https://www.mascomad.org/Animales/GetAnimalesFiltrados';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    // Step 1 — get CSRF token and session cookie from the listing page
    const listRes = await fetch(LISTING_URL, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'es-ES,es;q=0.9' },
    });
    const listHtml = await listRes.text();

    const csrfMatch = listHtml.match(/name="csrf-token" content="([^"]+)"/);
    const csrfToken = csrfMatch?.[1] ?? '';

    const setCookie = listRes.headers.get('set-cookie') ?? '';
    const cookieMatch = setCookie.match(/MascoMad\.Admin\.Antiforgery=([^;,\s]+)/);
    const cookieValue = cookieMatch?.[1] ?? '';

    if (!csrfToken || !cookieValue) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No se pudo obtener el token CSRF' }) };
    }

    // Step 2 — call the DataTables JSON API (fetch all in one shot)
    const apiRes = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'RequestVerificationToken': csrfToken,
        'Cookie': `MascoMad.Admin.Antiforgery=${cookieValue}`,
        'Referer': LISTING_URL,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ draw: 1, start: 0, length: 3000 }),
    });

    if (!apiRes.ok) {
      return { statusCode: apiRes.status, headers, body: JSON.stringify({ error: `API devolvió ${apiRes.status}` }) };
    }

    const data = await apiRes.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
