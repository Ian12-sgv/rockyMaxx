# Inventory Merchandise API Contract

Este documento define el contrato recomendado para el frontend del modulo de mercancia.
La base URL asumida es:

```text
http://localhost:3000/api
```

Todas las rutas de inventario requieren:

```http
Authorization: Bearer <token>
```

El token se obtiene con:

```http
POST /auth/login
Content-Type: application/json
```

```json
{
  "usuario": "admin",
  "password": "123456"
}
```

## Endpoints

- `GET /inventory`
- `GET /inventory/:codigoBarra`
- `POST /inventory`
- `PATCH /inventory/:codigoBarra`
- `DELETE /inventory/:codigoBarra`

## Contrato recomendado para crear mercancia

```http
POST /inventory
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "codigoBarra": "SMK001",
  "general": {
    "categoria": "TAZAS",
    "fabricante": "FABRICA DEMO",
    "marca": "LINEA HOGAR",
    "familia": "FAMTAZA001",
    "nombre": "Taza decorativa blanca",
    "puntoRecorte": "5",
    "nota": "Articulo de prueba",
    "tipo": "articulo",
    "status": "activo"
  },
  "tallasColores": {
    "talla": "U",
    "colores": "BLANCO"
  },
  "precios": {
    "impuesto": {
      "codigo": 1
    },
    "detal": "10.00",
    "mayor": "9.00",
    "afiliado": "8.50",
    "promocion": {
      "activa": true,
      "%descuento": "10",
      "porcentajeDescuento": "10",
      "precio": "9.00",
      "desde": "2026-04-20T00:00:00.000Z",
      "hasta": "2026-04-30T00:00:00.000Z"
    }
  }
}
```

## Contrato recomendado para editar mercancia

Envias solo los campos que van a cambiar.

```http
PATCH /inventory/SMK001
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "general": {
    "categoria": "TAZAS",
    "fabricante": "FABRICA DEMO",
    "nombre": "Taza decorativa blanca premium",
    "puntoRecorte": "8",
    "familia": "FAMTAZA001",
    "nota": "Actualizado desde frontend",
    "tipo": "articulo",
    "status": "activo"
  },
  "tallasColores": {
    "talla": "U",
    "colores": "NEGRO"
  },
  "precios": {
    "impuesto": {
      "codigo": 1
    },
    "detal": "12.00",
    "mayor": "11.00",
    "afiliado": "10.00",
    "promocion": {
      "activa": false
    }
  }
}
```

## Buscar mercancia

```http
GET /inventory?buscar=taza&page=1&limit=20
Authorization: Bearer <token>
```

Parametros disponibles:

- `buscar`: busca por codigo de barra, familia, nombre, categoria, fabricante, color o talla
- `categoria`
- `fabricante`
- `color`
- `talla`
- `familia`
- `tipo`: `articulo`, `servicio`, `0`, `1`
- `status`: `activo`, `inactivo`, `0`, `1`
- `page`
- `limit`

Respuesta:

```json
{
  "data": [
    {
      "codigoBarra": "SMK001",
      "codigoBarraAnt": "SMK001",
      "general": {
        "familia": "FAMTAZA001",
        "nombre": "Taza decorativa blanca",
        "categoria": {
          "codigo": "0001",
          "nombre": "TAZAS"
        },
        "fabricante": {
          "codigo": "FABRICADEMO",
          "nombre": "FABRICA DEMO"
        },
        "marca": {
          "codigo": "LIN",
          "nombre": "LINEA HOGAR"
        },
        "puntoRecorte": "5",
        "nota": "Articulo de prueba",
        "tipo": {
          "codigo": 0,
          "nombre": "articulo"
        },
        "status": {
          "codigo": 1,
          "nombre": "activo"
        }
      },
      "tallasColores": {
        "talla": {
          "codigo": "U"
        },
        "colores": {
          "codigo": "BLA",
          "nombre": "BLANCO"
        }
      },
      "precios": {
        "impuesto": {
          "codigo": 1,
          "nombre": "IVA",
          "porcentaje": "16"
        },
        "detal": "10.00",
        "mayor": "9.00",
        "afiliado": "8.50",
        "promocion": {
          "activa": true,
          "porcentajeDescuento": "10.00",
          "precio": "9.00",
          "desde": "2026-04-20T00:00:00.000Z",
          "hasta": "2026-04-30T00:00:00.000Z"
        }
      },
      "inventario": {
        "existenciaInicial": "0",
        "existenciaActual": "0",
        "costos": {
          "inicial": "0",
          "promedio": "0",
          "ultimo": "0",
          "dolar": "0"
        },
        "fechas": {
          "fechaInicial": "2026-04-20T00:00:00.000Z",
          "fechaFinal": "2026-04-30T00:00:00.000Z",
          "fechaPrimerMovimiento": "2026-04-20T12:00:00.000Z",
          "ultimaActualizacion": "2026-04-20T12:00:00.000Z"
        },
        "serializado": 0
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

## Consultar un articulo

```http
GET /inventory/SMK001
Authorization: Bearer <token>
```

Respuesta:

```json
{
  "mercancia": {
    "codigoBarra": "SMK001",
    "codigoBarraAnt": "SMK001",
    "general": {
      "familia": "FAMTAZA001",
      "nombre": "Taza decorativa blanca",
      "categoria": {
        "codigo": "0001",
        "nombre": "TAZAS"
      },
      "fabricante": {
        "codigo": "FABRICADEMO",
        "nombre": "FABRICA DEMO"
      },
      "marca": {
        "codigo": "LIN",
        "nombre": "LINEA HOGAR"
      },
      "puntoRecorte": "5",
      "nota": "Articulo de prueba",
      "tipo": {
        "codigo": 0,
        "nombre": "articulo"
      },
      "status": {
        "codigo": 1,
        "nombre": "activo"
      }
    },
    "tallasColores": {
      "talla": {
        "codigo": "U"
      },
      "colores": {
        "codigo": "BLA",
        "nombre": "BLANCO"
      }
    },
    "precios": {
      "impuesto": {
        "codigo": 1,
        "nombre": "IVA",
        "porcentaje": "16"
      },
      "detal": "10.00",
      "mayor": "9.00",
      "afiliado": "8.50",
      "promocion": {
        "activa": true,
        "porcentajeDescuento": "10.00",
        "precio": "9.00",
        "desde": "2026-04-20T00:00:00.000Z",
        "hasta": "2026-04-30T00:00:00.000Z"
      }
    },
    "inventario": {
      "existenciaInicial": "0",
      "existenciaActual": "0",
      "costos": {
        "inicial": "0",
        "promedio": "0",
        "ultimo": "0",
        "dolar": "0"
      },
      "fechas": {
        "fechaInicial": "2026-04-20T00:00:00.000Z",
        "fechaFinal": "2026-04-30T00:00:00.000Z",
        "fechaPrimerMovimiento": "2026-04-20T12:00:00.000Z",
        "ultimaActualizacion": "2026-04-20T12:00:00.000Z"
      },
      "serializado": 0
    }
  }
}
```

## Eliminar un articulo

```http
DELETE /inventory/SMK001
Authorization: Bearer <token>
```

Respuesta:

```json
{
  "mercancia": {
    "codigoBarra": "SMK001"
  }
}
```

## Reglas de mapeo importantes

- `familia` se guarda en la columna legacy `Referencia`.
- `puntoRecorte` se guarda en la columna legacy `PuntoReorden`.
- `tipo` se mapea asi:
  - `articulo` -> `0`
  - `servicio` -> `1`
- `status` se mapea asi:
  - `activo` -> `1`
  - `inactivo` -> `0`
- Si `promocion.activa` es `true`, debes enviar:
  - `precio` o `porcentajeDescuento`
  - `desde`
  - `hasta`
- La tabla legacy no tiene una columna propia para `% descuento`; por eso el backend lo devuelve calculado desde `detal` y `precioPromocion`.
- `categoria`, `fabricante`, `marca`, `color` e `impuesto` aceptan formatos mas flexibles, pero el formato recomendado para frontend es el de este documento.

## Notas practicas para frontend

- En creacion, `codigoBarra`, `general.nombre`, `general.familia`, `general.categoria`, `general.fabricante`, `tallasColores.talla` y `tallasColores.colores` son los datos minimos recomendados.
- Si no envias `general.marca`, el backend genera una compatible automaticamente.
- Si no envias `precios.impuesto`, el backend intenta usar el impuesto por defecto `1`.
- `PATCH` permite enviar solo los campos que cambian.
