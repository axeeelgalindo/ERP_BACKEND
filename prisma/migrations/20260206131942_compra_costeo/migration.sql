-- CreateTable
CREATE TABLE "CompraCosteo" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "compra_id" TEXT NOT NULL,
    "venta_id" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompraCosteo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompraCosteo_empresa_id_idx" ON "CompraCosteo"("empresa_id");

-- CreateIndex
CREATE INDEX "CompraCosteo_compra_id_idx" ON "CompraCosteo"("compra_id");

-- CreateIndex
CREATE INDEX "CompraCosteo_venta_id_idx" ON "CompraCosteo"("venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "CompraCosteo_compra_id_venta_id_key" ON "CompraCosteo"("compra_id", "venta_id");

-- AddForeignKey
ALTER TABLE "CompraCosteo" ADD CONSTRAINT "CompraCosteo_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraCosteo" ADD CONSTRAINT "CompraCosteo_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraCosteo" ADD CONSTRAINT "CompraCosteo_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
