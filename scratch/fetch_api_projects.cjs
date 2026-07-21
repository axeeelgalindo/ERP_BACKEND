const http = require('http');

function post(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function get(url, token, empresaId) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (empresaId) headers['x-empresa-id'] = empresaId;

    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          console.log("RAW GET RESPONSE:", body);
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log("Logging in...");
  const loginRes = await post('http://127.0.0.1:3002/api/login', {
    correo: 'admin@blueinge.com',
    contrasena: '12345'
  });

  console.log("LOGIN RESPONSE:", loginRes);

  const token = loginRes.token;
  const empresaId = loginRes.user?.empresa?.id || loginRes.usuario?.empresa_id || null;
  console.log("Logged in successfully! Token obtained. EmpresaID:", empresaId);

  console.log("Fetching projects...");
  const projectsRes = await get(`http://127.0.0.1:3002/api/proyectos?page=1&pageSize=10`, token, empresaId);
  
  console.log("API projects response count:", projectsRes.items?.length);
  if (projectsRes.items && projectsRes.items.length > 0) {
    const firstProject = projectsRes.items[0];
    console.log("First project details:", {
      id: firstProject.id,
      nombre: firstProject.nombre,
      cliente: firstProject.cliente,
      cotizacionesCount: firstProject.cotizaciones?.length
    });
    if (firstProject.cotizaciones?.length > 0) {
      console.log("First cotizacion details:", {
        id: firstProject.cotizaciones[0].id,
        cliente: firstProject.cotizaciones[0].cliente,
        ventasCount: firstProject.cotizaciones[0].ventas?.length
      });
    }
  } else {
    console.log("No projects returned.");
  }

  console.log("Fetching projects filtered by client ID cmll2n059001mjud9h451tuig...");
  const filteredRes = await get(`http://127.0.0.1:3002/api/proyectos?page=1&pageSize=10&clienteId=cmll2n059001mjud9h451tuig`, token, empresaId);
  console.log("Filtered projects count:", filteredRes.items?.length);
  if (filteredRes.items && filteredRes.items.length > 0) {
    console.log("Filtered project name:", filteredRes.items[0].nombre);
  }

  console.log("Fetching projects filtered by state finalizado...");
  const stateRes = await get(`http://127.0.0.1:3002/api/proyectos?page=1&pageSize=10&estado=finalizado`, token, empresaId);
  console.log("State filtered count:", stateRes.items?.length);
}

main().catch(err => console.error(err));
