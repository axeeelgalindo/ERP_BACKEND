import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

/* ========= AUTH ========= */
export const LoginBody = Type.Object({
  correo: Type.String({ format: "email" }),
  contrasena: Type.String({ minLength: 3 }),
});

/* ========= USUARIOS ========= */
// Agrego includeDeleted y force (para endpoints que lo usen)
export const UsuarioQuery = Type.Object({
  q: Type.Optional(Type.String()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  empresaId: Type.Optional(Type.String()), // para master
  includeDeleted: Type.Optional(
    Type.Union([Type.Boolean(), Type.Integer({ minimum: 0, maximum: 1 })])
  ),
  force: Type.Optional(
    Type.Union([Type.Boolean(), Type.Integer({ minimum: 0, maximum: 1 })])
  ),
});

export const UsuarioCreateBody = Type.Object({
  empresa_id: Type.String(),
  rol_id: Type.String(),
  nombre: Type.String({ minLength: 2 }),
  correo: Type.String({ format: "email" }),
  contrasena: Type.String({ minLength: 3 }),
});

export const UsuarioUpdateBody = Type.Partial(
  Type.Object({
    empresa_id: Type.String(),
    rol_id: Type.String(),
    nombre: Type.String({ minLength: 2 }),
    correo: Type.String({ format: "email" }),
    contrasena: Type.String({ minLength: 3 }),
  })
);

export const UsuarioIdParam = Type.Object({ id: Id });

/* ========= ROLES (en el mismo módulo de usuarios) ========= */
export const RolQuery = Type.Object({
  q: Type.Optional(Type.String()),
  includeDeleted: Type.Optional(
    Type.Union([Type.Boolean(), Type.Integer({ minimum: 0, maximum: 1 })])
  ),
});

export const RolCreateBody = Type.Object({
  nombre: Type.String({ minLength: 2 }),
  codigo: Type.Optional(Type.String({ minLength: 1 })),
  descripcion: Type.Optional(Type.String()),
  orden: Type.Optional(Type.Integer()),
  activo: Type.Optional(Type.Boolean()),
});

export const RolUpdateBody = Type.Partial(RolCreateBody);

export const RolIdParam = Type.Object({ id: Id });

// Para delete con ?force
export const ForceQuery = Type.Object({
  force: Type.Optional(
    Type.Union([Type.Boolean(), Type.Integer({ minimum: 0, maximum: 1 })])
  ),
});
