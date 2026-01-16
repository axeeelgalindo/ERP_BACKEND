-- CreateEnum
CREATE TYPE "EstadoCotizacion" AS ENUM ('COTIZACION', 'ORDEN_VENTA', 'FACTURADA', 'PAGADA');

-- CreateEnum
CREATE TYPE "cotizacionItemTipo" AS ENUM ('PRODUCTO', 'SERVICIO');

-- CreateEnum
CREATE TYPE "DetalleVentaModo" AS ENUM ('HH', 'COMPRA');

-- CreateEnum
CREATE TYPE "estadoCompra" AS ENUM ('ORDEN_COMPRA', 'FACTURADA', 'PAGADA');

-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rut" VARCHAR(40),
    "correo" TEXT,
    "telefono" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizada_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolUsuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "descripcion" TEXT,
    "orden" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "RolUsuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "rol_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "contrasena" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empleado" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "rut" VARCHAR(40),
    "cargo" TEXT,
    "telefono" TEXT,
    "fecha_ingreso" TIMESTAMP(3),
    "sueldo_base" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),
    "afp_id" TEXT,
    "salud_id" TEXT,

    CONSTRAINT "Empleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AFPConfig" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "tasa" DOUBLE PRECISION NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AFPConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaludConfig" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tasa" DOUBLE PRECISION NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaludConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rut" VARCHAR(40),
    "correo" TEXT,
    "telefono" TEXT,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proveedor" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rut" VARCHAR(40),
    "correo" TEXT,
    "telefono" TEXT,
    "notas" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "sku" TEXT,
    "precio" DOUBLE PRECISION NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proyecto" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "presupuesto" DOUBLE PRECISION,
    "estado" TEXT NOT NULL DEFAULT 'activo',
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Proyecto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProyectoMiembro" (
    "id" TEXT NOT NULL,
    "proyecto_id" TEXT NOT NULL,
    "empleado_id" TEXT NOT NULL,
    "rol" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProyectoMiembro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarea" (
    "id" TEXT NOT NULL,
    "proyecto_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "responsable_id" TEXT,
    "prioridad" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "avance" INTEGER NOT NULL DEFAULT 0,
    "es_hito" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER,
    "fecha_inicio_plan" TIMESTAMP(3) NOT NULL,
    "fecha_fin_plan" TIMESTAMP(3) NOT NULL,
    "dias_plan" INTEGER,
    "fecha_inicio_real" TIMESTAMP(3),
    "fecha_fin_real" TIMESTAMP(3),
    "dias_reales" INTEGER,
    "total_dias_plan" INTEGER,
    "total_dias_reales" INTEGER,
    "total_horas_plan" DOUBLE PRECISION,
    "total_horas_reales" DOUBLE PRECISION,
    "total_costo_plan" DOUBLE PRECISION,
    "total_costo_real" DOUBLE PRECISION,
    "total_responsables" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "jira_key" TEXT,
    "jira_tipo" TEXT,
    "jira_estado" TEXT,
    "jira_sprint" TEXT,
    "jira_issue_color" TEXT,
    "parent_id" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),
    "dias_desviacion" INTEGER,

    CONSTRAINT "Tarea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TareaDetalle" (
    "id" TEXT NOT NULL,
    "tarea_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "responsable_id" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "avance" INTEGER NOT NULL DEFAULT 0,
    "fecha_inicio_plan" TIMESTAMP(3) NOT NULL,
    "fecha_fin_plan" TIMESTAMP(3) NOT NULL,
    "dias_plan" INTEGER NOT NULL,
    "fecha_inicio_real" TIMESTAMP(3),
    "fecha_fin_real" TIMESTAMP(3),
    "dias_reales" INTEGER,
    "horas_plan" DOUBLE PRECISION,
    "horas_real" DOUBLE PRECISION,
    "valor_hora" DOUBLE PRECISION,
    "costo_plan" DOUBLE PRECISION,
    "costo_real" DOUBLE PRECISION,
    "dias_desviacion" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "jira_key" TEXT,
    "jira_tipo" TEXT,
    "jira_estado" TEXT,
    "jira_sprint" TEXT,
    "jira_issue_color" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "TareaDetalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TareaDependencia" (
    "id" TEXT NOT NULL,
    "tarea_id" TEXT NOT NULL,
    "predecesora_id" TEXT NOT NULL,
    "tipo" TEXT,

    CONSTRAINT "TareaDependencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cotizacion" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "proyecto_id" TEXT NOT NULL,
    "cliente_id" TEXT,
    "descripcion" TEXT,
    "cantidad" INTEGER,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "iva" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "terminos_condiciones" TEXT,
    "acuerdo_pago" TEXT,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),
    "estado" "EstadoCotizacion" NOT NULL DEFAULT 'COTIZACION',

    CONSTRAINT "Cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CotizacionItem" (
    "id" TEXT NOT NULL,
    "cotizacion_id" TEXT NOT NULL,
    "tipo" "cotizacionItemTipo" NOT NULL,
    "producto_id" TEXT,
    "Item" TEXT,
    "descripcion" TEXT,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CotizacionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venta" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordenVentaId" TEXT,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detalleVenta" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modo" "DetalleVentaModo" NOT NULL DEFAULT 'HH',
    "tipoItemId" TEXT,
    "compraId" TEXT,
    "costoUnitario" DOUBLE PRECISION,
    "costoTotal" DOUBLE PRECISION,
    "empleadoId" TEXT,
    "hhEmpleadoId" TEXT,
    "costoHH" DOUBLE PRECISION,
    "ventaUnitario" DOUBLE PRECISION,
    "ventaTotal" DOUBLE PRECISION,
    "utilidad" DOUBLE PRECISION,
    "porcentajeUtilidad" DOUBLE PRECISION,
    "alpha" DOUBLE PRECISION,
    "tipoDiaId" TEXT,
    "isFeriado" BOOLEAN NOT NULL DEFAULT false,
    "isUrgencia" BOOLEAN NOT NULL DEFAULT false,
    "isFinSemana" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "detalleVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoDia" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "TipoDia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidadItem" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "UnidadItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoItem" (
    "id" TEXT NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT,
    "porcentajeUtilidad" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unidadItemId" TEXT,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "TipoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compra" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "empresa_id" TEXT NOT NULL,
    "proyecto_id" TEXT,
    "estado" "estadoCompra" NOT NULL DEFAULT 'ORDEN_COMPRA',
    "total" DOUBLE PRECISION NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),
    "cotizacionId" TEXT,
    "proveedorId" TEXT,
    "tipo_doc" INTEGER,
    "folio" VARCHAR(50),
    "rut_proveedor" VARCHAR(40),
    "razon_social" VARCHAR(255),
    "fecha_docto" TIMESTAMP(3),
    "fecha_recepcion" TIMESTAMP(3),
    "factura_url" TEXT,
    "factura_numero" VARCHAR(50),
    "factura_fecha" TIMESTAMP(3),
    "factura_monto" DOUBLE PRECISION,

    CONSTRAINT "Compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompraItem" (
    "id" TEXT NOT NULL,
    "compra_id" TEXT,
    "producto_id" TEXT,
    "proveedor_id" TEXT,
    "item" TEXT,
    "cantidad" INTEGER NOT NULL,
    "precio_unit" DOUBLE PRECISION,
    "total" DOUBLE PRECISION NOT NULL,
    "tipoItemId" TEXT,

    CONSTRAINT "CompraItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rendicion" (
    "id" TEXT NOT NULL,
    "empleado_id" TEXT NOT NULL,
    "proyecto_id" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "monto_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,
    "revisada_por_id" TEXT,
    "fecha_revision" TIMESTAMP(3),
    "comentario_revision" TEXT,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Rendicion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RendicionItem" (
    "id" TEXT NOT NULL,
    "rendicion_id" TEXT NOT NULL,
    "linea" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "categoria" TEXT,
    "comprobante_url" TEXT,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RendicionItem_pkey" PRIMARY KEY ("id")
);

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
    "empleador" DOUBLE PRECISION,
    "pagado" DOUBLE PRECISION,
    "feriado" DOUBLE PRECISION,
    "indemnizacion" DOUBLE PRECISION,
    "total" DOUBLE PRECISION,
    "costoHH" DOUBLE PRECISION,
    "cif" DOUBLE PRECISION,
    "horasMensuales" DOUBLE PRECISION,
    "horasEfectivas" DOUBLE PRECISION,
    "raw" JSONB,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HHEmpleado_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RolUsuario_nombre_key" ON "RolUsuario"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "RolUsuario_codigo_key" ON "RolUsuario"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_correo_eliminado_key" ON "Usuario"("correo", "eliminado");

-- CreateIndex
CREATE UNIQUE INDEX "Empleado_usuario_id_key" ON "Empleado"("usuario_id");

-- CreateIndex
CREATE INDEX "Empleado_afp_id_idx" ON "Empleado"("afp_id");

-- CreateIndex
CREATE INDEX "Empleado_salud_id_idx" ON "Empleado"("salud_id");

-- CreateIndex
CREATE UNIQUE INDEX "AFPConfig_codigo_key" ON "AFPConfig"("codigo");

-- CreateIndex
CREATE INDEX "AFPConfig_empresa_id_idx" ON "AFPConfig"("empresa_id");

-- CreateIndex
CREATE INDEX "SaludConfig_empresa_id_idx" ON "SaludConfig"("empresa_id");

-- CreateIndex
CREATE INDEX "Cliente_empresa_id_idx" ON "Cliente"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_correo_eliminado_key" ON "Cliente"("correo", "eliminado");

-- CreateIndex
CREATE INDEX "Proveedor_empresa_id_idx" ON "Proveedor"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "Proveedor_correo_eliminado_key" ON "Proveedor"("correo", "eliminado");

-- CreateIndex
CREATE INDEX "Producto_empresa_id_idx" ON "Producto"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_sku_eliminado_key" ON "Producto"("sku", "eliminado");

-- CreateIndex
CREATE INDEX "Proyecto_empresa_id_idx" ON "Proyecto"("empresa_id");

-- CreateIndex
CREATE INDEX "ProyectoMiembro_empleado_id_idx" ON "ProyectoMiembro"("empleado_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProyectoMiembro_proyecto_id_empleado_id_key" ON "ProyectoMiembro"("proyecto_id", "empleado_id");

-- CreateIndex
CREATE INDEX "Tarea_proyecto_id_idx" ON "Tarea"("proyecto_id");

-- CreateIndex
CREATE INDEX "Tarea_responsable_id_idx" ON "Tarea"("responsable_id");

-- CreateIndex
CREATE INDEX "Tarea_estado_idx" ON "Tarea"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "Tarea_proyecto_id_jira_key_key" ON "Tarea"("proyecto_id", "jira_key");

-- CreateIndex
CREATE UNIQUE INDEX "TareaDetalle_tarea_id_jira_key_key" ON "TareaDetalle"("tarea_id", "jira_key");

-- CreateIndex
CREATE INDEX "TareaDependencia_predecesora_id_idx" ON "TareaDependencia"("predecesora_id");

-- CreateIndex
CREATE UNIQUE INDEX "TareaDependencia_tarea_id_predecesora_id_key" ON "TareaDependencia"("tarea_id", "predecesora_id");

-- CreateIndex
CREATE UNIQUE INDEX "Cotizacion_numero_key" ON "Cotizacion"("numero");

-- CreateIndex
CREATE INDEX "Cotizacion_empresa_id_idx" ON "Cotizacion"("empresa_id");

-- CreateIndex
CREATE INDEX "Cotizacion_proyecto_id_idx" ON "Cotizacion"("proyecto_id");

-- CreateIndex
CREATE INDEX "CotizacionItem_cotizacion_id_idx" ON "CotizacionItem"("cotizacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_numero_key" ON "Venta"("numero");

-- CreateIndex
CREATE INDEX "detalleVenta_ventaId_idx" ON "detalleVenta"("ventaId");

-- CreateIndex
CREATE INDEX "detalleVenta_modo_idx" ON "detalleVenta"("modo");

-- CreateIndex
CREATE INDEX "detalleVenta_tipoItemId_idx" ON "detalleVenta"("tipoItemId");

-- CreateIndex
CREATE INDEX "detalleVenta_compraId_idx" ON "detalleVenta"("compraId");

-- CreateIndex
CREATE INDEX "detalleVenta_empleadoId_idx" ON "detalleVenta"("empleadoId");

-- CreateIndex
CREATE INDEX "detalleVenta_hhEmpleadoId_idx" ON "detalleVenta"("hhEmpleadoId");

-- CreateIndex
CREATE INDEX "TipoDia_empresa_id_idx" ON "TipoDia"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "TipoDia_empresa_id_nombre_eliminado_key" ON "TipoDia"("empresa_id", "nombre", "eliminado");

-- CreateIndex
CREATE INDEX "UnidadItem_empresa_id_idx" ON "UnidadItem"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadItem_empresa_id_nombre_eliminado_key" ON "UnidadItem"("empresa_id", "nombre", "eliminado");

-- CreateIndex
CREATE INDEX "TipoItem_empresa_id_idx" ON "TipoItem"("empresa_id");

-- CreateIndex
CREATE INDEX "TipoItem_unidadItemId_idx" ON "TipoItem"("unidadItemId");

-- CreateIndex
CREATE UNIQUE INDEX "TipoItem_empresa_id_codigo_eliminado_key" ON "TipoItem"("empresa_id", "codigo", "eliminado");

-- CreateIndex
CREATE UNIQUE INDEX "TipoItem_empresa_id_nombre_eliminado_key" ON "TipoItem"("empresa_id", "nombre", "eliminado");

-- CreateIndex
CREATE UNIQUE INDEX "Compra_numero_key" ON "Compra"("numero");

-- CreateIndex
CREATE INDEX "Compra_empresa_id_idx" ON "Compra"("empresa_id");

-- CreateIndex
CREATE INDEX "Compra_proyecto_id_idx" ON "Compra"("proyecto_id");

-- CreateIndex
CREATE INDEX "CompraItem_compra_id_idx" ON "CompraItem"("compra_id");

-- CreateIndex
CREATE INDEX "CompraItem_tipoItemId_idx" ON "CompraItem"("tipoItemId");

-- CreateIndex
CREATE INDEX "Rendicion_proyecto_id_idx" ON "Rendicion"("proyecto_id");

-- CreateIndex
CREATE INDEX "Rendicion_estado_idx" ON "Rendicion"("estado");

-- CreateIndex
CREATE INDEX "Rendicion_revisada_por_id_idx" ON "Rendicion"("revisada_por_id");

-- CreateIndex
CREATE INDEX "RendicionItem_rendicion_id_idx" ON "RendicionItem"("rendicion_id");

-- CreateIndex
CREATE UNIQUE INDEX "RendicionItem_rendicion_id_linea_key" ON "RendicionItem"("rendicion_id", "linea");

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
CREATE INDEX "HHEmpleado_empresa_id_anio_mes_idx" ON "HHEmpleado"("empresa_id", "anio", "mes");

-- CreateIndex
CREATE INDEX "HHEmpleado_empleado_id_idx" ON "HHEmpleado"("empleado_id");

-- CreateIndex
CREATE INDEX "HHEmpleado_rut_idx" ON "HHEmpleado"("rut");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "RolUsuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_afp_id_fkey" FOREIGN KEY ("afp_id") REFERENCES "AFPConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_salud_id_fkey" FOREIGN KEY ("salud_id") REFERENCES "SaludConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AFPConfig" ADD CONSTRAINT "AFPConfig_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaludConfig" ADD CONSTRAINT "SaludConfig_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proyecto" ADD CONSTRAINT "Proyecto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProyectoMiembro" ADD CONSTRAINT "ProyectoMiembro_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProyectoMiembro" ADD CONSTRAINT "ProyectoMiembro_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarea" ADD CONSTRAINT "Tarea_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Tarea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaDetalle" ADD CONSTRAINT "TareaDetalle_tarea_id_fkey" FOREIGN KEY ("tarea_id") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaDetalle" ADD CONSTRAINT "TareaDetalle_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaDependencia" ADD CONSTRAINT "TareaDependencia_tarea_id_fkey" FOREIGN KEY ("tarea_id") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaDependencia" ADD CONSTRAINT "TareaDependencia_predecesora_id_fkey" FOREIGN KEY ("predecesora_id") REFERENCES "Tarea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cotizacion" ADD CONSTRAINT "Cotizacion_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotizacionItem" ADD CONSTRAINT "CotizacionItem_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "Cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CotizacionItem" ADD CONSTRAINT "CotizacionItem_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_ordenVentaId_fkey" FOREIGN KEY ("ordenVentaId") REFERENCES "Cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_tipoDiaId_fkey" FOREIGN KEY ("tipoDiaId") REFERENCES "TipoDia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_tipoItemId_fkey" FOREIGN KEY ("tipoItemId") REFERENCES "TipoItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "CompraItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_hhEmpleadoId_fkey" FOREIGN KEY ("hhEmpleadoId") REFERENCES "HHEmpleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalleVenta" ADD CONSTRAINT "detalleVenta_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoDia" ADD CONSTRAINT "TipoDia_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidadItem" ADD CONSTRAINT "UnidadItem_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoItem" ADD CONSTRAINT "TipoItem_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoItem" ADD CONSTRAINT "TipoItem_unidadItemId_fkey" FOREIGN KEY ("unidadItemId") REFERENCES "UnidadItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "Cotizacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compra" ADD CONSTRAINT "Compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_tipoItemId_fkey" FOREIGN KEY ("tipoItemId") REFERENCES "TipoItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompraItem" ADD CONSTRAINT "CompraItem_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "Proveedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendicion" ADD CONSTRAINT "Rendicion_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "Empleado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendicion" ADD CONSTRAINT "Rendicion_proyecto_id_fkey" FOREIGN KEY ("proyecto_id") REFERENCES "Proyecto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendicion" ADD CONSTRAINT "Rendicion_revisada_por_id_fkey" FOREIGN KEY ("revisada_por_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RendicionItem" ADD CONSTRAINT "RendicionItem_rendicion_id_fkey" FOREIGN KEY ("rendicion_id") REFERENCES "Rendicion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HHEmpleado" ADD CONSTRAINT "HHEmpleado_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HHEmpleado" ADD CONSTRAINT "HHEmpleado_empleado_id_fkey" FOREIGN KEY ("empleado_id") REFERENCES "Empleado"("id") ON DELETE SET NULL ON UPDATE CASCADE;
