-- AlterTable
ALTER TABLE "Tarea" ADD COLUMN     "epica_id" TEXT;

-- CreateTable
CREATE TABLE "Epica" (
    "id" TEXT NOT NULL,
    "proyecto_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "avance" INTEGER NOT NULL DEFAULT 0,
    "orden" INTEGER,
    "fecha_inicio_plan" TIMESTAMP(3),
    "fecha_fin_plan" TIMESTAMP(3),
    "dias_plan" INTEGER,
    "fecha_inicio_real" TIMESTAMP(3),
    "fecha_fin_real" TIMESTAMP(3),
    "dias_reales" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "jira_key" TEXT,
    "jira_estado" TEXT,
    "jira_sprint" TEXT,
    "jira_issue_color" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Epica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Epica_proyecto_id_idx" ON "Epica"("proyecto_id");

-- CreateIndex
CREATE UNIQUE INDEX "Epica_proyecto_id_jira_key_key" ON "Epica"("proyecto_id", "jira_key");

-- CreateIndex
CREATE INDEX "Tarea_epica_id_idx" ON "Tarea"("epica_id");

-- AddForeignKey
ALTER TABLE "Epica" ADD CONSTRAINT "Epica_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_epica_id_fkey" FOREIGN KEY ("epica_id") REFERENCES "Epica"("id") ON DELETE SET NULL ON UPDATE CASCADE;
