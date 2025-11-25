import { Type } from "@sinclair/typebox";

const Id = Type.String({ minLength: 10 });

export const TareaQuery = Type.Object({
  proyectoId: Type.Optional(Id),
  responsableId: Type.Optional(Id),
  estado: Type.Optional(Type.String()),
  desde: Type.Optional(Type.String({ format: "date-time" })),
  hasta: Type.Optional(Type.String({ format: "date-time" })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  sort: Type.Optional(Type.String()),
  includeDeleted: Type.Optional(
    Type.Union([Type.Boolean(), Type.Integer({ minimum: 0, maximum: 1 })])
  ),
});

export const TareaCreateBody = Type.Object({
  proyecto_id: Id,
  nombre: Type.String({ minLength: 2 }),
  descripcion: Type.Optional(Type.String()),
  responsable_id: Type.Optional(Id),
  prioridad: Type.Optional(Type.Integer()),
  estado: Type.Optional(Type.String()),
  avance: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  es_hito: Type.Optional(Type.Boolean()),
  orden: Type.Optional(Type.Integer()),
  fecha_inicio_plan: Type.String({ format: "date-time" }),
  fecha_fin_plan: Type.String({ format: "date-time" }),
  fecha_inicio_real: Type.Optional(Type.String({ format: "date-time" })),
  fecha_fin_real: Type.Optional(Type.String({ format: "date-time" })),
});

export const TareaUpdateBody = Type.Partial(TareaCreateBody);
export const TareaIdParam = Type.Object({ id: Id });

export const TareaDepCreate = Type.Object({
  tarea_id: Id,
  predecesora_id: Id,
  tipo: Type.Optional(Type.String()), // FS/SS/FF/SF
});
export const TareaDepIdParam = Type.Object({ id: Id });
