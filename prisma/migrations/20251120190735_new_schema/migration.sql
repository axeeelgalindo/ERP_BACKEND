-- AlterTable
ALTER TABLE "Rendicion" ADD COLUMN     "comentario_revision" TEXT,
ADD COLUMN     "fecha_revision" TIMESTAMP(3),
ADD COLUMN     "revisada_por_id" TEXT;

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "cotizacion_id" TEXT;

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT,
    "usuario_id" TEXT,
    "entidad" TEXT NOT NULL,
    "registro_id" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "detalles" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_empresa_id_idx" ON "AuditLog"("empresa_id");

-- CreateIndex
CREATE INDEX "AuditLog_usuario_id_idx" ON "AuditLog"("usuario_id");

-- CreateIndex
CREATE INDEX "AuditLog_entidad_registro_id_idx" ON "AuditLog"("entidad", "registro_id");

-- CreateIndex
CREATE INDEX "AuditLog_accion_idx" ON "AuditLog"("accion");

-- CreateIndex
CREATE INDEX "AuditLog_creado_en_idx" ON "AuditLog"("creado_en");

-- CreateIndex
CREATE INDEX "Rendicion_estado_idx" ON "Rendicion"("estado");

-- CreateIndex
CREATE INDEX "Rendicion_revisada_por_id_idx" ON "Rendicion"("revisada_por_id");

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "Cotizacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendicion" ADD CONSTRAINT "Rendicion_revisada_por_id_fkey" FOREIGN KEY ("revisada_por_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
