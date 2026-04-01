async function main() {
  const baseUrl = process.env.API_URL ?? 'http://localhost:4000';
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD ?? 'admin';

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${loginRes.statusText}`);
  }
  const { token } = await loginRes.json();

  const devices = [
    { name: 'PC 01', type: 'pc' },
    { name: 'PC 02', type: 'pc' },
    { name: 'PS5 01', type: 'console' },
  ];

  for (const d of devices) {
    const res = await fetch(`${baseUrl}/devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(d),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Create device failed (${d.name}): ${res.status} ${text}`);
    }
  }

  const listRes = await fetch(`${baseUrl}/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(await listRes.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

