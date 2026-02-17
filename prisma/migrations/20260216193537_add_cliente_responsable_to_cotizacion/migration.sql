-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN     "cliente_responsable_id" TEXT;

-- CreateIndex
CREATE INDEX "Cotizacion_cliente_responsable_id_idx" ON "Cotizacion"("cliente_responsable_id");

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_cliente_responsable_id_fkey" FOREIGN KEY ("cliente_responsable_id") REFERENCES "ClienteResponsable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
