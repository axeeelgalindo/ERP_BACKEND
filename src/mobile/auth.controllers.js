// src/mobile/auth.controllers.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const mobileLogin = (server) => async (request, reply) => {
  const { rut, contrasena } = request.body || {};

  if (!rut || !contrasena) {
    return reply.badRequest("RUT y contraseña son obligatorios");
  }

  // normalizar: quitar todo excepto numeros y K, pasar a mayuscula
  const cleaned = rut.replace(/[^0-9kK]/g, "").toUpperCase();
  if (cleaned.length < 2) {
    return reply.unauthorized("RUT inválido");
  }

  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1);

  // Formato con puntos (ej: 21.166.343-K)
  const formattedRut = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv;
  // Formato simple (ej: 21166343-K)
  const cleanRutWithDash = body + "-" + dv;

  // 1. Buscar rut con cualquier formato
  const row = await prisma.empleado.findFirst({
    where: {
      OR: [
        { rut: formattedRut },
        { rut: cleanRutWithDash },
        { rut: rut }
      ],
      eliminado: false,
      usuario: {
        eliminado: false,
        empresa: { eliminado: false }
      }
    },
    include: {
      usuario: { select: { id: true, nombre: true, empresa_id: true } }
    }
  });

  if (!row || !row.usuario) {
    return reply.unauthorized("Credenciales inválidas o empleado deshabilitado");
  }

  // 2. Extraer ultimos 5 digitos del RUT sin contar digito verificador de la DB
  const rawBody = row.rut.split("-")[0].replace(/\./g, ""); // sacamos puntos "21166343"
  const expectedPassword = rawBody.slice(-5); // "66343"

  if (String(contrasena).trim() !== String(expectedPassword)) {
    return reply.unauthorized(`Credenciales inválidas. Hint pwd: ${expectedPassword}`);
  }

  // 3. Generar JWT (usando la misma logica del ERP para compatibilidad de scope)
  const payload = {
    sub: row.usuario.id,
    userId: row.usuario.id,
    empleadoId: row.id,
    nombre: row.usuario.nombre,
    empresa: { id: row.usuario.empresa_id },
    rol: { nombre: "EMPLEADO_MOVIL" }
  };

  const token = server.jwt.sign(payload, { expiresIn: "30d" });

  return reply.send({ token, user: payload });
};
