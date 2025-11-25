// src/lib/errors.js
export function httpError(reply, status, msg) {
  return reply.code(status).send({ ok: false, msg });
}
