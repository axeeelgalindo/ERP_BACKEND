-- CreateEnum
CREATE TYPE "TareaHistorialTipo" AS ENUM ('ESTADO', 'AVANCE', 'FECHA_REAL', 'COMENTARIO', 'IMPORT');

-- CreateTable
CREATE TABLE "TareaHistorial" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "proyecto_id" TEXT NOT NULL,
    "tarea_id" TEXT NOT NULL,
    "tipo" "TareaHistorialTipo" NOT NULL,
    "from_estado" TEXT,
    "to_estado" TEXT,
    "from_avance" INTEGER,
    "to_avance" INTEGER,
    "from_inicio_real" TIMESTAMP(3),
    "to_inicio_real" TIMESTAMP(3),
    "from_fin_real" TIMESTAMP(3),
    "to_fin_real" TIMESTAMP(3),
    "source" TEXT,
    "actor_id" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TareaHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TareaHistorial_empresa_id_proyecto_id_occurred_at_idx" ON "TareaHistorial"("empresa_id", "proyecto_id", "occurred_at");

-- CreateIndex
CREATE INDEX "TareaHistorial_tarea_id_occurred_at_idx" ON "TareaHistorial"("tarea_id", "occurred_at");

-- CreateIndex
CREATE INDEX "TareaHistorial_proyecto_id_occurred_at_idx" ON "TareaHistorial"("proyecto_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "TareaHistorial" ADD CONSTRAINT "TareaHistorial_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaHistorial" ADD CONSTRAINT "TareaHistorial_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaHistorial" ADD CONSTRAINT "TareaHistorial_tarea_id_fkey" FOREIGN KEY ("tarea_id") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
