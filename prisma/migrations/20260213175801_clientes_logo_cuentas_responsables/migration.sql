-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "cuenta_principal_id" TEXT,
ADD COLUMN     "logo_public_id" TEXT,
ADD COLUMN     "logo_url" TEXT;

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "clienteId" TEXT;

-- CreateTable
CREATE TABLE "ClienteCuentaBancaria" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "tipo_cuenta" TEXT,
    "numero" TEXT NOT NULL,
    "titular" TEXT,
    "rut_titular" TEXT,
    "correo_pago" TEXT,
    "swift" TEXT,
    "iban" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "ClienteCuentaBancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteResponsable" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT,
    "telefono" TEXT,
    "cargo" TEXT,
    "area" TEXT,
    "es_principal" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "ClienteResponsable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClienteCuentaBancaria_cliente_id_idx" ON "ClienteCuentaBancaria"("cliente_id");

-- CreateIndex
CREATE INDEX "ClienteResponsable_cliente_id_idx" ON "ClienteResponsable"("cliente_id");

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_cuenta_principal_id_fkey" FOREIGN KEY ("cuenta_principal_id") REFERENCES "ClienteCuentaBancaria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteCuentaBancaria" ADD CONSTRAINT "ClienteCuentaBancaria_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteResponsable" ADD CONSTRAINT "ClienteResponsable_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
