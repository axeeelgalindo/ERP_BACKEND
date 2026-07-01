export const getBancoCentralUF = async (request, reply) => {
  try {
    const todayStr = new Date().toISOString().split("T")[0];
    const { start = todayStr, end = todayStr } = request.query;

    const user = "soporte@blueinge.com";
    const pass = "Blue2026!";
    const timeseries = "F073.UFF.PRE.Z.D";
    const func = "GetSeries";

    const url = `https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}&function=${func}&timeseries=${timeseries}&firstdate=${start}&lastdate=${end}`;

    const res = await fetch(url);
    if (!res.ok) {
      return reply.code(res.status).send({
        success: false,
        error: `HTTP error from Banco Central: status ${res.status}`,
      });
    }

    const data = await res.json();

    // Validar si el Banco Central reportó algún error en su respuesta JSON
    if (data?.Codigo !== 0 && data?.Codigo !== "0") {
      return reply.code(400).send({
        success: false,
        error: data?.Descripcion || "Error retornado por Banco Central",
      });
    }

    const obsList = data?.Series?.Obs;
    const formattedData = [];

    if (Array.isArray(obsList)) {
      for (const obs of obsList) {
        formattedData.push({
          fecha: obs.indexDateString,
          valor: Number(obs.value), // Convert string to Float
          estado: obs.statusCode,
        });
      }
    }

    return reply.send({
      success: true,
      data: formattedData,
    });
  } catch (error) {
    request.log?.error?.(error);
    return reply.code(500).send({
      success: false,
      error: "Error interno al obtener el valor de la UF",
      detalle: error.message,
    });
  }
};
