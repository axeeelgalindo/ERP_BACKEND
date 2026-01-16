-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN     "vendedor_id" TEXT;

-- CreateIndex
CREATE INDEX "Cotizacion_vendedor_id_idx" ON "Cotizacion"("vendedor_id");

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
