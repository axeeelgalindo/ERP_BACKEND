import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

export const ProyectoQuery = Type.Object({
  q: Type.Optional(Type.String()),
  estado: Type.Optional(Type.String()),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  empresaId: Type.Optional(Type.String()),
  includeDeleted: Type.Optional(
    Type.Union([Type.Boolean(), Type.Integer({ minimum: 0, maximum: 1 })])
  ),
});

export const ProyectoCreateBody = Type.Object(
  {
    nombre: Type.String({ minLength: 2 }),
    descripcion: Type.Optional(Type.String()),
    // a veces viene como string desde inputs -> lo aceptamos también
    presupuesto: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    estado: Type.Optional(Type.String()),
    // miembros del proyecto (empleados)
    miembrosIds: Type.Optional(Type.Array(Type.String({ minLength: 10 }))),
    // si tu UI manda clienteId hoy, lo aceptamos aunque tu modelo no lo guarde
    clienteId: Type.Optional(Type.String({ minLength: 10 })),
  },
  { additionalProperties: true }
);

// ✅ aceptar ambos formatos:
// - { nombre, ... }
// - { proyecto: { nombre, ... } }
export const ProyectoCreateRequestBody = Type.Union([
  ProyectoCreateBody,
  Type.Object({ proyecto: ProyectoCreateBody }, { additionalProperties: true }),
]);

export const ProyectoUpdateBody = Type.Partial(ProyectoCreateBody);
export const ProyectoIdParam = Type.Object({ id: Id });
