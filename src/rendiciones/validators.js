import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 }); // cuid()

export const RendicionQuery = Type.Object({
  q: Type.Optional(Type.String()),
  estado: Type.Optional(Type.String()), // pendiente | aprobada | rechazada (según definas)
  empleadoId: Type.Optional(Id),
  proyectoId: Type.Optional(Id),
  desde: Type.Optional(Type.String({ format: "date-time" })),
  hasta: Type.Optional(Type.String({ format: "date-time" })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  empresaId: Type.Optional(Type.String()), // MASTER
  includeDeleted: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
  force: Type.Optional(Type.Union([
    Type.Boolean(),
    Type.Integer({ minimum: 0, maximum: 1 })
  ])),
});

const RendItem = Type.Object({
  linea: Type.Optional(Type.Integer({ minimum: 1 })), // si no llega, se asigna
  fecha: Type.Optional(Type.String({ format: "date-time" })),
  descripcion: Type.Optional(Type.String()),
  monto: Type.Number({ minimum: 0 }),
  categoria: Type.Optional(Type.String()),
  comprobante_url: Type.Optional(Type.String()),
});

export const RendicionCreateBody = Type.Object({
  empleado_id: Id,
  proyecto_id: Id,
  descripcion: Type.Optional(Type.String()),
  estado: Type.Optional(Type.String()),
  items: Type.Array(RendItem),
});

export const RendicionUpdateBody = Type.Partial(RendicionCreateBody);
export const RendicionIdParam = Type.Object({ id: Id });

/* Items individuales */
export const RendItemCreateBody = Type.Object({
  fecha: Type.Optional(Type.String({ format: "date-time" })),
  descripcion: Type.Optional(Type.String()),
  monto: Type.Number({ minimum: 0 }),
  categoria: Type.Optional(Type.String()),
  comprobante_url: Type.Optional(Type.String()),
});
export const RendItemUpdateBody = Type.Partial(RendItemCreateBody);
export const RendItemIdParam = Type.Object({ id: Id });
