/*
  Warnings:

  - You are about to drop the column `proveedor_id` on the `Compra` table. All the data in the column will be lost.
  - The `numero` column on the `Compra` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `estado` column on the `Compra` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `estado` column on the `Cotizacion` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `precio_unit` on the `CotizacionItem` table. All the data in the column will be lost.
  - You are about to drop the column `actualizado_en` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `cliente_id` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `cotizacion_id` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `creada_en` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `eliminado` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `eliminado_en` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `empresa_id` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `estado` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `proyecto_id` on the `Venta` table. All the data in the column will be lost.
  - You are about to drop the column `total` on the `Venta` table. All the data in the column will be lost.
  - The `numero` column on the `Venta` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `EmpleadoRemuneracion` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EmpleadoRemuneracionConcepto` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HHConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RemuneracionPeriodo` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VentaItem` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `precioUnitario` to the `CotizacionItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tipo` to the `CotizacionItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EstadoCotizacion" AS ENUM ('COTIZACION', 'ORDEN_VENTA', 'FACTURADA', 'PAGADA');

-- CreateEnum
CREATE TYPE "cotizacionItemTipo" AS ENUM ('PRODUCTO', 'SERVICIO');

-- CreateEnum
CREATE TYPE "estadoCompra" AS ENUM ('ORDEN_COMPRA', 'FACTURADA', 'PAGADA');

-- DropForeignKey
ALTER TABLE "Compra" DROP CONSTRAINT "Compra_proveedor_id_fkey";

-- DropForeignKey
ALTER TABLE "CompraItem" DROP CONSTRAINT "CompraItem_producto_id_fkey";

-- DropForeignKey
ALTER TABLE "CotizacionItem" DROP CONSTRAINT "CotizacionItem_producto_id_fkey";

-- DropForeignKey
ALTER TABLE "EmpleadoRemuneracion" DROP CONSTRAINT "EmpleadoRemuneracion_empleado_id_fkey";

-- DropForeignKey
ALTER TABLE "EmpleadoRemuneracion" DROP CONSTRAINT "EmpleadoRemuneracion_periodo_id_fkey";

-- DropForeignKey
ALTER TABLE "EmpleadoRemuneracionConcepto" DROP CONSTRAINT "EmpleadoRemuneracionConcepto_remuneracion_id_fkey";

-- DropForeignKey
ALTER TABLE "HHConfig" DROP CONSTRAINT "HHConfig_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "RemuneracionPeriodo" DROP CONSTRAINT "RemuneracionPeriodo_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "Venta" DROP CONSTRAINT "Venta_cliente_id_fkey";

-- DropForeignKey
ALTER TABLE "Venta" DROP CONSTRAINT "Venta_cotizacion_id_fkey";

-- DropForeignKey
ALTER TABLE "Venta" DROP CONSTRAINT "Venta_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "Venta" DROP CONSTRAINT "Venta_proyecto_id_fkey";

-- DropForeignKey
ALTER TABLE "VentaItem" DROP CONSTRAINT "VentaItem_producto_id_fkey";

-- DropForeignKey
ALTER TABLE "VentaItem" DROP CONSTRAINT "VentaItem_venta_id_fkey";

-- DropIndex
DROP INDEX "Venta_empresa_id_idx";

-- DropIndex
DROP INDEX "Venta_proyecto_id_idx";

-- AlterTable
ALTER TABLE "Compra" DROP COLUMN "proveedor_id",
ADD COLUMN     "cotizacionId" TEXT,
ADD COLUMN     "proveedorId" TEXT,
ALTER COLUMN "proyecto_id" DROP NOT NULL,
DROP COLUMN "numero",
ADD COLUMN     "numero" SERIAL NOT NULL,
DROP COLUMN "estado",
ADD COLUMN     "estado" "estadoCompra" NOT NULL DEFAULT 'ORDEN_COMPRA',
ALTER COLUMN "total" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CompraItem" ADD COLUMN     "item" TEXT,
ADD COLUMN     "proveedor_id" TEXT,
ALTER COLUMN "compra_id" DROP NOT NULL,
ALTER COLUMN "precio_unit" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Cotizacion" DROP COLUMN "estado",
ADD COLUMN     "estado" "EstadoCotizacion" NOT NULL DEFAULT 'COTIZACION';

-- AlterTable
ALTER TABLE "CotizacionItem" DROP COLUMN "precio_unit",
ADD COLUMN     "Item" TEXT,
ADD COLUMN     "precioUnitario" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "tipo" "cotizacionItemTipo" NOT NULL;

-- AlterTable
ALTER TABLE "Venta" DROP COLUMN "actualizado_en",
DROP COLUMN "cliente_id",
DROP COLUMN "cotizacion_id",
DROP COLUMN "creada_en",
DROP COLUMN "eliminado",
DROP COLUMN "eliminado_en",
DROP COLUMN "empresa_id",
DROP COLUMN "estado",
DROP COLUMN "proyecto_id",
DROP COLUMN "total",
ADD COLUMN     "descripcion" TEXT,
ADD COLUMN     "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ordenVentaId" TEXT,
DROP COLUMN "numero",
ADD COLUMN     "numero" SERIAL NOT NULL;

-- DropTable
DROP TABLE "EmpleadoRemuneracion";

-- DropTable
DROP TABLE "EmpleadoRemuneracionConcepto";

-- DropTable
DROP TABLE "HHConfig";

-- DropTable
DROP TABLE "RemuneracionPeriodo";

-- DropTable
DROP TABLE "VentaItem";

-- CreateTable
CREATE TABLE "detalleVenta" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "costoTotal" DOUBLE PRECISION,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipoItemId" TEXT,
    "compraId" TEXT,
    "costoHH" DOUBLE PRECISION,
    "costoUnitario" DOUBLE PRECISION,
    "ventaUnitario" DOUBLE PRECISION,
    "ventaTotal" DOUBLE PRECISION,
    "utilidad" DOUBLE PRECISION,
    "porcentajeUtilidad" DOUBLE PRECISION,
    "empleadoId" TEXT,
    "hhEmpleadoId" TEXT,
    "total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "detalleVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipoItem" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "porcentajeUtilidad" DOUBLE PRECISION NOT NULL,
    "unidadItemId" TEXT,

    CONSTRAINT "tipoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidadItem" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "unidadItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HHEmpleado" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "empleado_id" TEXT,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "nombre_periodo" TEXT,
    "nombre" TEXT,
    "rut" VARCHAR(40),
    "dias_trabajados" INTEGER,
    "sueldo_base" DOUBLE PRECISION,
    "extras" DOUBLE PRECISION,
    "gratificacion" DOUBLE PRECISION,
    "imponible1" DOUBLE PRECISION,
    "imponible2" DOUBLE PRECISION,
    "movilizacion" DOUBLE PRECISION,
    "colacion" DOUBLE PRECISION,
    "imponible3" DOUBLE PRECISION,
    "imponible4" DOUBLE PRECISION,
    "haberes" DOUBLE PRECISION,
    "afp" DOUBLE PRECISION,
    "unico" DOUBLE PRECISION,
    "previsional" DOUBLE PRECISION,
    "salud" DOUBLE PRECISION,
    "antiguo" DOUBLE PRECISION,
    "anticipos" DOUBLE PRECISION,
    "prestamos" DOUBLE PRECISION,
    "apv" DOUBLE PRECISION,
    "desctos1" DOUBLE PRECISION,
    "desctos2" DOUBLE PRECISION,
    "liquido" DOUBLE PRECISION,
    "pagado" DOUBLE PRECISION,
    "feriado" DOUBLE PRECISION,
    "indemnizacion" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "costoHH" DOUBLE PRECISION,
    "cif" DOUBLE PRECISION,
    "horasEfectivas" DOUBLE PRECISION,
    "raw" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HHEmpleado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "detalleVenta_ventaId_idx" ON "detalleVenta"("ventaId");

-- CreateIndex
CREATE INDEX "HHEmpleado_empresa_id_anio_mes_idx" ON "HHEmpleado"("empresa_id", "anio", "mes");

-- CreateIndex
CREATE INDEX "HHEmpleado_empleado_id_idx" ON "HHEmpleado"("empleado_id");

-- CreateIndex
CREATE INDEX "HHEmpleado_rut_idx" ON "HHEmpleado"("rut");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_numero_key" ON "Compra"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_numero_key" ON "Venta"("numero");

-- AddForeignKey
ALTER TABLE "CotizacionItem" ADD CONSTRAINT "CotizacionItem_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_ordenVentaId_fkey" FOREIGN KEY ("ordenVentaId") REFERENCES "Cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_tipoItemId_fkey" FOREIGN KEY ("tipoItemId") REFERENCES "tipoItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_hhEmpleadoId_fkey" FOREIGN KEY ("hhEmpleadoId") REFERENCES "HHEmpleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipoItem" ADD CONSTRAINT "tipoItem_unidadItemId_fkey" FOREIGN KEY ("unidadItemId") REFERENCES "unidadItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "Cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "Proveedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HHEmpleado" ADD CONSTRAINT "HHEmpleado_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HHEmpleado" ADD CONSTRAINT "HHEmpleado_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;
