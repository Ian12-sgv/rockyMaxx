Option Explicit
Dim CodigoNodo              As String
Public WithEvents Spread    As clsSpread
Dim CatInventario           As New ADODB.Command
Dim CatCliente              As New ADODB.Command
Dim CatVendedor             As New ADODB.Command
Dim rcsUltimaFactura        As New ADODB.Recordset
Dim dicConfiguracionBalanza     As New Dictionary
Dim dPesoBalanza                As Double
Dim bHabilitarVisorPrecios      As Boolean
Dim bCajaPermiteFacturaContingencia As Boolean
Dim bLecturaBalanza As Boolean

Dim intCantidadItemsFactura As Integer
Dim varCodigoBarra          As String
Dim varCedulaVendedor       As String
Dim varPorcentajeUtilidad   As Double

Dim varDetal                As Double
Dim varMayor                As Double
Dim VarAfiliado             As Double
Dim varPPromocion           As Double
Dim varPromocion            As Byte
Dim varFechaInicial         As Date
Dim varFechaFinal           As Date
Dim VarImpuesto             As Double
Dim VarPrecioLista          As Double
Dim VarPrecioFactura        As Double
Dim VarDescuento            As Double
Dim VarAfiliadoEspecial     As Boolean
Dim ColDef                  As Long
Dim VarNumeroOrden          As Long
Dim varFormaCargada         As Boolean
Dim gUltimaFactura          As Long
Dim PermiteReferenciaMarca      As Boolean

Dim vCredito                    As Double
Dim EsCredito                   As Boolean
Dim respuesta                   As Long
Dim VarServicio                 As String
Dim PermitirVentasCatalogo      As String
Dim PermitirSelecconReglas      As String
Dim varCambiarPreciosAutorizado As Boolean
Dim varTipoConvenio             As String
Dim varSelector                 As String

Private Sub cmdCancelar_Click()
    If SpreadMovimiento.DataRowCnt > 0 Then
        If MsgBox("Desea eliminar los datos cargados?", vbQuestion + vbYesNo, "Eliminar item") = vbYes Then
            If EliminarItemRequiereAutorizacion Then
               If Not PermiteEliminarItem Then
                   MsgBox "Ud no esta autorizado para eliminar items de facturacion"
                   Exit Sub
               End If
            End If
            Call registrarItemsBorrados("C")
            Call AsignarFormula
            InicializarSpreads
            InicializarVariables
        End If
    Else
        Call AsignarFormula
        InicializarSpreads
        InicializarVariables
    End If
End Sub

Private Sub cmdCambiarPrecio_Click()
    If RequiereAutorizacionCambiarPrecios Then
        If PerteneceAlGrupoAdministrador(strUsuarioActivo) Then
            varCambiarPreciosAutorizado = True
            Spread.Accion_Spread7 SpreadMovimiento, 1, 4, SpreadMovimiento.DataRowCnt, 4, DESBLOQUEAR
        Else
            bClaveAdmi_Correcta = False
            frmClaveAutorizada.TipoAutorizacion = PermitirCambiarPreciosFacturacion
            frmClaveAutorizada.Show 1
            If bClaveAdmi_Correcta Then
                varCambiarPreciosAutorizado = True
                Spread.Accion_Spread7 SpreadMovimiento, 1, 4, SpreadMovimiento.DataRowCnt, 4, DESBLOQUEAR
            Else
                varCambiarPreciosAutorizado = False
                Spread.Accion_Spread7 SpreadMovimiento, 1, 4, SpreadMovimiento.DataRowCnt, 4, BLOQUEAR
            End If
        End If
    Else
        varCambiarPreciosAutorizado = True
        Spread.Accion_Spread7 SpreadMovimiento, 1, 4, SpreadMovimiento.DataRowCnt, 4, DESBLOQUEAR
    End If
End Sub

Private Sub cmdCongelar_Click()
Dim VCodigoPago             As Byte
Dim VFila                   As Long
Dim Numero                  As Long
Dim regAfect                As Long
Dim VItem                   As Long
Dim VFormaPago              As String
Dim VDocumento              As String
Dim Vlote                   As String
Dim VBanco                  As String
Dim VPuntoVenta             As String
Dim VMonto                  As String
Dim VTipoLista              As String
Dim VCodigoBarra            As String
Dim VPrecio                 As String
Dim VPrecioLista            As String
Dim VCosto                  As String
Dim VImpuesto               As String
Dim VPorcentajeImpuesto     As String
Dim vPorcentajedescuento    As String
Dim VCantidad               As String
Dim vDescuento              As String

    If Not DatosCompletosCongelar Then Exit Sub
    On Error GoTo Errores
    cmdCongelar.Enabled = False
    cnnConexion.BeginTrans
    varCambiarPreciosAutorizado = False
    
    Numero = ValorMaximo("HISTVENTAS", "Numero")
    WriteLog ("Congelando Factura - " & CStr(Numero) & "-" & varSerie)
    ISQL = "INSERT INTO HISTVENTAS(Numero,Serie,Fecha,Vendedor,Cliente,TipoVenta,FormaPago,DiasCredito,Usuario,Status,NumeroOrden,Exenta)"
    ISQL = ISQL & "VALUES(" & Numero & ",'" & varSerie & "','" & Format(Now, "yyyymmdd hh:mm:ss am/pm") & "','" & varCedulaVendedor & "','" & txtCliente & "'," & varTipoVenta & ",1,0,'" & strUsuarioActivo & "',1," & VarNumeroOrden & "," & chkFacturaExentaDeImpuesto.Value & ")"
    cnnConexion.Execute ISQL
   
    VItem = 1
    VFila = 1
    SpreadMovimiento.Col = 2
    While VFila <= SpreadMovimiento.DataRowCnt
        SpreadMovimiento.Row = VFila
        SpreadMovimiento.Col = 1
        VTipoLista = SpreadMovimiento.Text
        SpreadMovimiento.Col = 2
        VCodigoBarra = SpreadMovimiento.Text
        SpreadMovimiento.Col = 4
        VPrecio = SpreadMovimiento.Text
        SpreadMovimiento.Col = 5
        VCantidad = SpreadMovimiento.Text
        SpreadMovimiento.Col = 7
        VPrecioLista = SpreadMovimiento.Text
        SpreadMovimiento.Col = 8
        vDescuento = SpreadMovimiento.Text
        SpreadMovimiento.Col = 10
        VImpuesto = SpreadMovimiento.Text
        SpreadMovimiento.Col = 12
        VPorcentajeImpuesto = SpreadMovimiento.Text
        SpreadMovimiento.Col = 13
        VCosto = SpreadMovimiento.Text
        SpreadMovimiento.Col = 17
        vPorcentajedescuento = SpreadMovimiento.Text
        
        ISQL = "INSERT INTO HISTMOVVENTAS(Numero,Serie,Hora,TipoLista,CodigoBarra,Precio,PrecioLista,Costo,Impuesto,PorcentajeImpuesto,Cantidad,Descuento,Item,PorcentajeDescuento) "
        ISQL = ISQL & "VALUES(" & Numero & ",'" & varSerie & "','" & Format(Now, "yyyymmdd hh:mm:ss am/pm") & "','" & VTipoLista & "','" & VCodigoBarra & "'," & CorregirComa(VPrecio) & "," & CorregirComa(VPrecioLista) & ","
        ISQL = ISQL & CorregirComa(VCosto) & "," & CorregirComa(VImpuesto) & "," & CorregirComa(VPorcentajeImpuesto) & "," & CorregirComa(VCantidad) & "," & CorregirComa(vDescuento) & "," & VItem & "," & CorregirComa(vPorcentajedescuento) & ")"
        cnnConexion.Execute ISQL
        VItem = VItem + 1
        VFila = VFila + 1
    Wend
    ISQL = "UPDATE HISTVENTAS SET TotalMercancia = (SELECT SUM(Cantidad*Precio) FROM HISTMOVVENTAS WHERE Numero = " & Numero & " AND Serie ='" & varSerie & "' AND CONVERT(char,HISTVENTAS.Fecha,112) = '" & Format(Date, "yyyymmdd") & "')"
    ISQL = ISQL & ",TotalDescuento = (SELECT SUM(Cantidad*(Precio-PrecioLista)) FROM HISTMOVVENTAS WHERE Numero = " & Numero & " AND Serie ='" & varSerie & "' AND CONVERT(char,HISTVENTAS.Fecha,112) = '" & Format(Date, "yyyymmdd") & "')"
    ISQL = ISQL & ",TotalImpuesto  = (SELECT SUM(Cantidad*(Impuesto)) FROM HISTMOVVENTAS WHERE Numero = " & Numero & " AND Serie ='" & varSerie & "' AND CONVERT(char,HISTVENTAS.Fecha,112) = '" & Format(Date, "yyyymmdd") & "')"
    ISQL = ISQL & ",TotalCosto  = (SELECT SUM(Cantidad*(Costo)) FROM HISTMOVVENTAS WHERE Numero = " & Numero & " AND Serie ='" & varSerie & "' AND CONVERT(char,HISTVENTAS.Fecha,112) = '" & Format(Date, "yyyymmdd") & "')"
    ISQL = ISQL & "WHERE HISTVENTAS.Numero = " & Numero & " AND HISTVENTAS.Serie ='" & varSerie & "' AND CONVERT(char,HISTVENTAS.Fecha,112) = '" & Format(Date, "yyyymmdd") & "'"
    cnnConexion.Execute ISQL
    cnnConexion.CommitTrans
    Call InicializarSpreads
    Unload frmPagosVenta
    Call InicializarVariables
    Spread.Accion_Spread7 SpreadMovimiento, SpreadMovimiento.DataRowCnt + 1, 2, SpreadMovimiento.DataRowCnt + 1, 2, DESBLOQUEAR
    SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
    txtCliente.SetFocus
    cmdCongelar.Enabled = True
    Exit Sub
Errores:
    cmdCongelar.Enabled = True
    MsgBox "Error: " & Err.Number & " : " & Err.Description & "." & Chr(13), vbInformation, "Información"
    cnnConexion.RollbackTrans
End Sub
Private Sub registrarItemBorrados()

Dim VFila               As Long
Dim VTipoLista          As String
Dim VCodigoBarra        As String
Dim VPrecio             As String
Dim VPrecioLista        As String
Dim VCosto              As String
Dim VImpuesto           As String
Dim VPorcentajeImpuesto As String
Dim VCantidad           As String
Dim vDescuento          As String
Dim VItem               As Long
Dim VFormaPago          As String
Dim VCodigoPago         As Byte
Dim VDocumento          As String
Dim Vlote               As String
Dim VBanco              As String
Dim VPuntoVenta         As String
Dim VMonto              As String
Dim Numero              As Long
Dim regAfect            As Long
Dim Row As Long
    On Error GoTo Errores
    cnnConexion.BeginTrans
    Row = SpreadMovimiento.ActiveRow
    VItem = Row
    VFila = Row
    SpreadMovimiento.Col = 2
    SpreadMovimiento.Row = VFila
    SpreadMovimiento.Col = 1
    VTipoLista = SpreadMovimiento.Text
    SpreadMovimiento.Col = 2
    VCodigoBarra = SpreadMovimiento.Text
    SpreadMovimiento.Col = 4
    VPrecio = SpreadMovimiento.Text
    SpreadMovimiento.Col = 5
    VCantidad = SpreadMovimiento.Text
    SpreadMovimiento.Col = 7
    VPrecioLista = SpreadMovimiento.Text
    SpreadMovimiento.Col = 8
    vDescuento = SpreadMovimiento.Text
    SpreadMovimiento.Col = 10
    VImpuesto = SpreadMovimiento.Text
    SpreadMovimiento.Col = 12
    VPorcentajeImpuesto = SpreadMovimiento.Text
    SpreadMovimiento.Col = 13
    VCosto = SpreadMovimiento.Text
    ISQL = "INSERT INTO MOVVENTASBORRADAS(NumeroFactura,Serie,Hora,TipoLista,CodigoBarra,Precio,PrecioLista,Costo,Impuesto,PorcentajeImpuesto,Cantidad,CantidadDevuelta,Item,TpoBorrado,Vendedor,Cliente,Cajero,UsuarioAutoriza) "
    ISQL = ISQL & "VALUES(" & gUltimaFactura & ",'" & varSerie & "','" & Format(Now, "yyyymmdd hh:mm:ss am/pm") & "','" & VTipoLista & "','" & VCodigoBarra & "'," & CorregirComa(VPrecio) & "," & CorregirComa(VPrecioLista) & ","
    ISQL = ISQL & CorregirComa(VCosto) & "," & CorregirComa(VImpuesto) & "," & CorregirComa(VPorcentajeImpuesto) & "," & CorregirComa(VCantidad) & ",0," & VItem & ",'S','" & varCedulaVendedor & "' ,'" & txtCliente & "','" & strUsuarioActivo & "','" & varUsuarioAutorizaEliminacion & "')"
    cnnConexion.Execute ISQL
    cnnConexion.CommitTrans
    Exit Sub
Errores:
    cnnConexion.RollbackTrans
    MsgBox "Error: " & Err.Number & " : " & Err.Description & "." & Chr(13), vbInformation, "Información"
End Sub
Private Sub registrarItemsBorrados(tipsalida As String)
Dim VFila               As Long
Dim VTipoLista          As String
Dim VCodigoBarra        As String
Dim VPrecio             As String
Dim VPrecioLista        As String
Dim VCosto              As String
Dim VImpuesto           As String
Dim VPorcentajeImpuesto As String
Dim VCantidad           As String
Dim vDescuento          As String
Dim VItem               As Long
Dim VFormaPago          As String
Dim VCodigoPago         As Byte
Dim VDocumento          As String
Dim Vlote               As String
Dim VBanco              As String
Dim VPuntoVenta         As String
Dim VMonto              As String
Dim Numero              As Long
Dim regAfect            As Long
On Error GoTo Errores
    cnnConexion.BeginTrans
    VItem = 1
    VFila = 1
    SpreadMovimiento.Col = 2
    While VFila <= SpreadMovimiento.DataRowCnt
        SpreadMovimiento.Row = VFila
        SpreadMovimiento.Col = 1
        VTipoLista = SpreadMovimiento.Text
        SpreadMovimiento.Col = 2
        VCodigoBarra = SpreadMovimiento.Text
        SpreadMovimiento.Col = 4
        VPrecio = SpreadMovimiento.Text
        SpreadMovimiento.Col = 5
        VCantidad = SpreadMovimiento.Text
        SpreadMovimiento.Col = 7
        VPrecioLista = SpreadMovimiento.Text
        SpreadMovimiento.Col = 8
        vDescuento = SpreadMovimiento.Text
        SpreadMovimiento.Col = 10
        VImpuesto = SpreadMovimiento.Text
        SpreadMovimiento.Col = 12
        VPorcentajeImpuesto = SpreadMovimiento.Text
        SpreadMovimiento.Col = 13
        VCosto = SpreadMovimiento.Text
        
        ISQL = "INSERT INTO MOVVENTASBORRADAS(NumeroFactura,Serie,Hora,TipoLista,CodigoBarra,Precio,PrecioLista,Costo,Impuesto,PorcentajeImpuesto,Cantidad,CantidadDevuelta,Item,TpoBorrado,Vendedor,Cliente,Cajero, UsuarioAutoriza) "
        ISQL = ISQL & "VALUES(" & gUltimaFactura & ",'" & varSerie & "','" & Format(Now, "yyyymmdd hh:mm:ss am/pm") & "','" & VTipoLista & "','" & VCodigoBarra & "'," & CorregirComa(VPrecio) & "," & CorregirComa(VPrecioLista) & ","
        ISQL = ISQL & CorregirComa(VCosto) & "," & CorregirComa(VImpuesto) & "," & CorregirComa(VPorcentajeImpuesto) & "," & CorregirComa(VCantidad) & ",0," & VItem & ",'" & tipsalida & "','" & varCedulaVendedor & "' ,'" & txtCliente & "','" & strUsuarioActivo & "','" & varUsuarioAutorizaEliminacion & "')"
        cnnConexion.Execute ISQL
        VItem = VItem + 1
        VFila = VFila + 1
    Wend
    cnnConexion.CommitTrans
    Exit Sub
Errores:
    cnnConexion.RollbackTrans
    MsgBox "Error: " & Err.Number & " : " & Err.Description & "." & Chr(13), vbInformation, "Información"
End Sub

Private Sub cmdDescongelar_Click()
Dim CatCongeladas As New ADODB.Command
Dim Campo_Captado As Variant

    If SpreadMovimiento.DataRowCnt > 0 Then Exit Sub
    ISQL = "SELECT Numero AS [~HDN1],Cliente,C.Nombre AS NombreCliente,Vendedor,V.Nombre AS NombreVendedor,Fecha,TotalMercancia,TotalImpuesto,TotalMercancia+TotalImpuesto AS TotalVenta FROM HISTVENTAS H INNER JOIN CLIENTES C ON H.Cliente = C.Codigo "
    ISQL = ISQL & " INNER JOIN TRABAJADORES V ON H.Vendedor = V.Cedula WHERE Serie = '" & varSerie & "' ORDER BY Numero"
    CatCongeladas.CommandType = adCmdText
    CatCongeladas.Prepared = True
    CatCongeladas.CommandText = ISQL
    CatCongeladas.ActiveConnection = cnnConexion
    Campo_Captado = BuscarEnCatalogo(CatCongeladas)
    If Campo_Captado(1) <> "" Then
        WriteLog ("Descongelando factura - " & Campo_Captado(1))
        Call DescongelarFactura(Campo_Captado(1))
        Call EliminarCongelada(Campo_Captado(1))
        Call BloquearDesbloquearCliente
        txtPorcentajeDescuento = Format((txtTotalDescuento * 100) / txtTotalMercancia, "#,#0.00")
    End If
    Set CatCongeladas = Nothing
End Sub

Private Sub EliminarCongelada(ByVal Numero As Long)
    ISQL = "DELETE FROM HISTVENTAS WHERE Numero = " & Numero & " "
    cnnConexion.Execute ISQL
End Sub

Private Sub DescongelarFactura(ByVal Numero As Long)
Dim rcs As ADODB.Recordset

    Set rcs = New ADODB.Recordset
    varCambiarPreciosAutorizado = False
    ISQL = "SELECT * FROM HISTVENTAS WHERE Numero = " & Numero & " "
    rcs.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
    If rcs.RecordCount <> 0 Then
        Call CargarClienteCongelado(rcs!Cliente)
        Call CargarVendedorCongelado(rcs!Vendedor)
        VarNumeroOrden = rcs!NumeroOrden
        chkFacturaExentaDeImpuesto = rcs!Exenta
        chkFacturaExentaDeImpuesto.Enabled = False
        txtCliente.Enabled = False
        cmdClientes.Enabled = False
    End If
    rcs.Close
    ISQL = "SELECT TipoLista,H.CodigoBarra,Nombre,Precio,PrecioLista,Descuento,Costo,Impuesto,PorcentajeImpuesto,Cantidad,Referencia,CodigoMarca,PorcentajeDescuento "
    ISQL = ISQL & "FROM HISTMOVVENTAS H INNER JOIN INVENTARIO I ON H.CodigoBarra = I.CodigoBarra "
    ISQL = ISQL & " WHERE Numero = " & Numero & " ORDER BY Item "
    rcs.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
    SpreadMovimiento.Row = 1
    While Not rcs.EOF
        DoEvents
        SpreadMovimiento.Col = 1
        SpreadMovimiento.Text = rcs!TipoLista
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = rcs!CodigoBarra
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = rcs!Nombre
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Precio)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Cantidad)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Cantidad * rcs!Precio)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!PrecioLista)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Descuento)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        If VarUsaImpresoraFiscal = 1 Then
            SpreadMovimiento.Text = CDbl(Round(((rcs!Precio * rcs!Cantidad) * Round((1 - (rcs!PrecioLista / rcs!Precio)), 2)), 2))
        Else
            SpreadMovimiento.Text = CDbl(rcs!Descuento) * CDbl(rcs!Cantidad)
        End If
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Impuesto)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Impuesto * rcs!Cantidad)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!PorcentajeImpuesto)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Costo)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Costo * rcs!Cantidad)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = rcs!Referencia
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = rcs!CodigoMarca
        If VarItemsPorFactura <> 0 Then
            If Not ValidarItemsPorFactura(SpreadMovimiento, rcs!Referencia, 15, rcs!CodigoMarca, 16) Then rcs.MoveNext
        End If
        
        SpreadMovimiento.Col = 17
        SpreadMovimiento.Text = CDbl(rcs!PorcentajeDescuento)
        
        SpreadMovimiento.Row = SpreadMovimiento.Row + 1
        If SpreadMovimiento.Row = SpreadMovimiento.MaxRows Then
            Call InsertarFila
        End If
        rcs.MoveNext
    Wend
    Spread.Accion_Spread7 SpreadMovimiento, 1, 2, SpreadMovimiento.DataRowCnt, 2, BLOQUEAR
    Spread.Accion_Spread7 SpreadMovimiento, 1, 5, SpreadMovimiento.DataRowCnt, 5, DESBLOQUEAR
    If CDbl(txtPorcentajeDescuento) = 0 Then
        Spread.Accion_Spread7 SpreadMovimiento, SpreadMovimiento.DataRowCnt + 1, 2, SpreadMovimiento.DataRowCnt + 1, 2, DESBLOQUEAR
        SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
        SpreadMovimiento.SetFocus
    End If
    rcs.Close
    Set rcs = Nothing
    Call AsignarFormula
    Call MostrarTotales
End Sub

Private Sub CargarOrdenDespacho(ByVal Numero As Long)
Dim rcs As ADODB.Recordset
Dim i   As Integer

    Set rcs = New ADODB.Recordset
    ISQL = "SELECT * FROM ORDENDESPACHO WHERE Numero = " & Numero & " "
    rcs.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
    If rcs.RecordCount <> 0 Then
        Call CargarClienteCongelado(rcs!Cliente)
        chkFacturaExentaDeImpuesto.Value = rcs!Exenta
    End If
    rcs.Close
    ISQL = "SELECT TipoLista,M.CodigoBarra,Nombre,Precio,PrecioLista,Descuento,Costo,Impuesto,PorcentajeImpuesto,Cantidad,Referencia,CodigoMarca "
    ISQL = ISQL & "FROM MOVORDENDESPACHO M INNER JOIN INVENTARIO I ON M.CodigoBarra = I.CodigoBarra "
    ISQL = ISQL & " WHERE Numero = " & Numero & " ORDER BY Item "
    rcs.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
    If rcs.RecordCount > SpreadMovimiento.MaxRows Then
        SpreadMovimiento.MaxRows = rcs.RecordCount + 1
        Call AsignarFormula
        Call MostrarTotales
    End If
    SpreadMovimiento.Row = 1
    While Not rcs.EOF
        DoEvents
        SpreadMovimiento.Col = 1
        SpreadMovimiento.Text = rcs!TipoLista
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = rcs!CodigoBarra
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = rcs!Nombre
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Precio)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Cantidad)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Cantidad * rcs!Precio)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!PrecioLista)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Descuento)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(Round(((rcs!Precio * rcs!Cantidad) * Round((1 - (rcs!PrecioLista / rcs!Precio)), 2)), 2))
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        'SpreadMovimiento.Text = CDbl(rcs!Impuesto)
        SpreadMovimiento.Text = CDbl(rcs!Precio) * (CDbl(rcs!PorcentajeImpuesto) / 100)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
      ' SpreadMovimiento.Text = CDbl(rcs!Impuesto * rcs!Cantidad)
        SpreadMovimiento.Text = CDbl(rcs!Precio * rcs!Cantidad) * (CDbl(rcs!PorcentajeImpuesto) / 100)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!PorcentajeImpuesto)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Costo)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = CDbl(rcs!Costo * rcs!Cantidad)
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = rcs!Referencia
        SpreadMovimiento.Col = SpreadMovimiento.Col + 1
        SpreadMovimiento.Text = rcs!CodigoMarca
        If VarItemsPorFactura <> 0 Then
            If Not ValidarItemsPorFactura(SpreadMovimiento, rcs!Referencia, 15, rcs!CodigoMarca, 16) Then rcs.MoveNext
        End If
        SpreadMovimiento.Row = SpreadMovimiento.Row + 1
        SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
        rcs.MoveNext
    Wend
    
    For i = 1 To SpreadMovimiento.DataRowCnt
        SpreadMovimiento.Row = i
        Call RecalcularLinea(SpreadMovimiento, SpreadMovimiento.Row, 4, 5, 12, 11, 6, 7, 8, 9, 10, 17)
    Next
        
    Spread.Accion_Spread7 SpreadMovimiento, 1, 2, SpreadMovimiento.DataRowCnt, 2, BLOQUEAR
    Spread.Accion_Spread7 SpreadMovimiento, 1, 5, SpreadMovimiento.DataRowCnt, 5, DESBLOQUEAR
    
    If CDbl(txtPorcentajeDescuento) = 0 Then
        Spread.Accion_Spread7 SpreadMovimiento, SpreadMovimiento.DataRowCnt + 1, 2, SpreadMovimiento.DataRowCnt + 1, 2, DESBLOQUEAR
        SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
    End If
    rcs.Close
    Set rcs = Nothing
    Call AsignarFormula
    Call MostrarTotales
End Sub

Private Sub CargarClienteCongelado(ByVal Codigo As String)
Dim rcsCliente As ADODB.Recordset
            
    Set rcsCliente = New ADODB.Recordset
    ISQL = "SELECT C.Codigo, C.Nombre, C.Tipo,T.Descripcion as TipoCliente,C.TipoContribuyente,C.PorcentajeUtilidad FROM CLIENTES C INNER JOIN TIPOSCLIENTE T ON C.Tipo = T.Codigo "
    ISQL = ISQL & " WHERE C.Codigo = '" & Codigo & "'"
    rcsCliente.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
    
    If Not rcsCliente.EOF Then
        varTipoCliente = rcsCliente!tipo
        If varTipoCliente > 1 Then
            txtCliente.Enabled = False
            cmdClientes.Enabled = False
        End If
        lblTipoCliente = "CLIENTE TIPO : " & rcsCliente!TIPOCLIENTE
        txtCliente = rcsCliente!Codigo
        txtNombreCliente = rcsCliente!Nombre
        varTipoContribuyente = rcsCliente!TipoContribuyente
        varPorcentajeUtilidad = rcsCliente!PorcentajeUtilidad
    End If
    rcsCliente.Close
    Set rcsCliente = Nothing
End Sub

Private Sub CargarVendedorCongelado(ByVal Cedula As String)
Dim rcsVendedor As ADODB.Recordset
            
    Set rcsVendedor = New ADODB.Recordset
    ISQL = "SELECT Codigo,Cedula,Nombre FROM TRABAJADORES WHERE Cedula = '" & Cedula & "'"
    rcsVendedor.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
    If Not rcsVendedor.EOF Then
        txtVendedor = rcsVendedor!Codigo
        txtNombreVendedor = rcsVendedor!Nombre
        varCedulaVendedor = rcsVendedor!Cedula
    End If
    rcsVendedor.Close
    Set rcsVendedor = Nothing
End Sub

Private Sub cmdDescuento_Click()
    If SpreadMovimiento.DataRowCnt = 0 Then
        MsgBox "Debe especificar al menos un artículo...!", vbInformation, "Información"
        SpreadMovimiento.SetActiveCell 2, 1
        SpreadMovimiento.SetFocus
        Exit Sub
    End If
    If PermiteAccesoDescuento Then
        txtPorcentajeDescuento.Enabled = True
        txtPorcentajeDescuento.SetFocus
        cmdDescuento.Enabled = False
    End If
End Sub

Private Sub cmdListaPrecios_Click()
Dim rcsListaPrecio As ADODB.Recordset
Dim varBarra As String, VarLetra As String

    If varListaPrecio = 3 Then
        SpreadMovimiento.Col = 1: SpreadMovimiento.Row = SpreadMovimiento.ActiveRow
        VarLetra = SpreadMovimiento.Text
        SpreadMovimiento.Col = 2: SpreadMovimiento.Row = SpreadMovimiento.ActiveRow
        varBarra = SpreadMovimiento.Text
        If Len(varBarra) <> 0 Then
            varDetal = 0: varMayor = 0: varPromocion = 0: varPPromocion = 0: VarImpuesto = 0
            Set rcsListaPrecio = New ADODB.Recordset
            ISQL = "SELECT PrecioDetal, PrecioMayor, Promocion, PrecioPromocion, FechaInicial, FechaFinal, PorcentajeImpuesto "
            ISQL = ISQL & "FROM INVENTARIO INNER JOIN IMPUESTOS ON TipoImpuesto = Codigo WHERE CodigoBarra = '" & varBarra & "'"
            rcsListaPrecio.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
            If Not rcsListaPrecio.EOF Then
                varDetal = rcsListaPrecio!PrecioDetal
                varMayor = rcsListaPrecio!PrecioMayor
                VarImpuesto = rcsListaPrecio!PorcentajeImpuesto
                varPromocion = rcsListaPrecio!Promocion
                varPPromocion = rcsListaPrecio!PrecioPromocion
                varFechaInicial = rcsListaPrecio!FechaInicial
                varFechaFinal = rcsListaPrecio!FechaFinal
            End If
            rcsListaPrecio.Close
            Set rcsListaPrecio = Nothing
Alternar:
            Select Case VarLetra
            Case "A", "E"
                MsgBox "Solo puede alternar entre la listas de precios detal y mayor...!", vbInformation, "Información"
                Exit Sub
            Case "D"
                VarLetra = "M"
                varTipoPrecio = "M"
                varTipoCliente = 4
                VarPrecioFactura = varMayor
                VarPrecioLista = varMayor
            Case "M"
                If varPromocion And varFechaInicial <= Date And varFechaFinal >= Date Then
                    VarLetra = "P"
                    varTipoPrecio = "P"
                    varTipoCliente = 1
                    VarPrecioFactura = varDetal
                    VarPrecioLista = varPPromocion
                Else
                    VarLetra = "D"
                    varTipoPrecio = "D"
                    varTipoCliente = 1
                    VarPrecioFactura = varDetal
                    VarPrecioLista = varDetal
                End If
            Case "P"
                VarLetra = "D"
                varTipoPrecio = "D"
                varTipoCliente = 1
                VarPrecioFactura = varDetal
                VarPrecioLista = varDetal
            End Select
            
            VarDescuento = VarPrecioFactura - VarPrecioLista
            SpreadMovimiento.Row = SpreadMovimiento.ActiveRow
            SpreadMovimiento.Col = 1:  SpreadMovimiento.Text = varTipoPrecio
            SpreadMovimiento.Col = 4:  SpreadMovimiento.Text = VarPrecioFactura
            SpreadMovimiento.Col = 7:  SpreadMovimiento.Text = VarPrecioLista
            SpreadMovimiento.Col = 8:  SpreadMovimiento.Text = VarDescuento
            If chkFacturaExentaDeImpuesto.Value Then  ' si la factura completa es exenta de impuesto
                SpreadMovimiento.Col = 10: SpreadMovimiento.Text = "0"
            Else
                If VarUsaImpresoraFiscal = 1 Then
                    SpreadMovimiento.Col = 10: SpreadMovimiento.Text = (VarPrecioFactura - VarDescuento) * (VarImpuesto / 100)
                Else
                    SpreadMovimiento.Col = 10: SpreadMovimiento.Text = Round((VarPrecioFactura - VarDescuento) * (VarImpuesto / 100), 2)
                End If
            End If
            Call RecalcularLinea(SpreadMovimiento, SpreadMovimiento.Row, 4, 5, 12, 11, 6, 7, 8, 9, 10, 17)
            Call MostrarTotales
            If VarPrecioFactura = 0 Then
                MsgBox "No se puede vender el artículo con precio cero...", vbInformation, "Información"
                GoTo Alternar
            End If
        Else
            MsgBox "Seleccione la fila con datos para cambiar lista de precio...!", vbInformation, "Información"
        End If
    Else
        MsgBox "Caja ó Usuario no autorizado para cambiar listas de precio...!", vbInformation, "Información"
    End If
End Sub

Private Sub cmdOrdenDespacho_Click()
Dim CatOrdenDespacho  As New ADODB.Command
Dim Campo_Captado As Variant
Dim fecha As String

    varCambiarPreciosAutorizado = False
    If SpreadMovimiento.DataRowCnt > 0 Then Exit Sub
    ISQL = "SELECT Numero ,Cliente,C.Nombre AS NombreCliente,Fecha,TotalMercancia,Observacion,O.Status,O.Exenta FROM ORDENDESPACHO O INNER JOIN CLIENTES C ON O.Cliente = C.Codigo "
    ISQL = ISQL & "  WHERE O.Status =1 "
    If varMargenFacturarOrdenDespacho = 1 Then
        ISQL = ISQL & " AND MONTH(Fecha) = " & Month(Date) & " AND YEAR(Fecha) = " & Year(Date) & " "
    Else
        If varDiasFacturarOrdenDespacho = 0 Then
            ISQL = ISQL & "AND DAY(Fecha) = " & Day(Date) & " AND MONTH(Fecha) = " & Month(Date) & " AND YEAR(Fecha) = " & Year(Date) & " "
        Else
            fecha = Date - varDiasFacturarOrdenDespacho
            fecha = Format(fecha, "YYYYMMDD") + " 00:00:01"
            ISQL = ISQL & "AND Fecha >= '" & fecha & "'  "
        End If
    End If
    ISQL = ISQL & " ORDER BY Numero"
    CatOrdenDespacho.CommandType = adCmdText
    CatOrdenDespacho.Prepared = True
    CatOrdenDespacho.CommandText = ISQL
    CatOrdenDespacho.ActiveConnection = cnnConexion
    Campo_Captado = BuscarEnCatalogo(CatOrdenDespacho)
    If Campo_Captado(1) <> "" Then
        VarNumeroOrden = Campo_Captado(1)
        Call CargarOrdenDespacho(Campo_Captado(1))
        Call BloquearDesbloquearCliente
        txtVendedor.SetFocus
    End If
    Set CatOrdenDespacho = Nothing
    txtCliente.Enabled = True
    cmdClientes.Enabled = True
End Sub

Private Sub cmdPrevisualizar_Click()
Dim VItem                   As Long
Dim VFila                   As Long
Dim regAfect                As Long
Dim NombreTablaTemp         As String
Dim NombreTablaResult       As String
Dim SQL                     As String
Dim VTipoLista              As String
Dim VCodigoBarra            As String
Dim VPrecioLista            As String
Dim VPrecio                 As String
Dim VCantidad               As String
Dim VImpuesto               As String
Dim VCosto                  As String
Dim vPorcentajedescuento    As String
Dim VPorcentajeImpuesto     As String
Dim ImprimirDescuento       As Boolean
Dim bEsContingencia         As Boolean
Dim sqlComando              As ADODB.Command
Dim rcsResultado            As New ADODB.Recordset
Dim rcsSaldos               As New ADODB.Recordset

    WriteLog ("Previsualizacion pulsada")
    If SpreadMovimiento.DataRowCnt = 0 Then
        MsgBox "Debe seleccionar al menos un articulo."
        Exit Sub
    End If
    
    If Not ValidarApertura Then Exit Sub
    If Not DatosCompletos Then Exit Sub
        
    cmdDescuento.Enabled = False
    cmdCongelar.Enabled = False
    cmdDescongelar.Enabled = False
    cmdSalir.Enabled = False
    cmdCancelar.Enabled = False
    cmdOrdenDespacho.Enabled = False
    cmdListaPrecios.Enabled = False
    cmdPrevisualizar.Enabled = False
    
    FacturacionRealizada = False
    bEsContingencia = IIf(chkFacturaContingencia.Value = 1, True, False)
    
    Cadena = GenerarCadena(10)
        
    NombreTablaTemp = "##Facturacion_" & Cadena
    NombreTablaResult = "##Resultado_" & Cadena
    
    SQL = "IF (SELECT ISNULL (OBJECT_ID(N'TEMPDB.." & NombreTablaTemp & "'),0)) > 0 "
    SQL = SQL & "BEGIN "
    SQL = SQL & "DROP TABLE " & NombreTablaTemp & " "
    SQL = SQL & "END "
    cnnConexion.Execute SQL, regAfect
    
    SQL = "IF (SELECT ISNULL (OBJECT_ID(N'TEMPDB.." & NombreTablaResult & "'),0)) > 0 "
    SQL = SQL & "BEGIN "
    SQL = SQL & "DROP TABLE " & NombreTablaResult & " "
    SQL = SQL & "END "
    cnnConexion.Execute SQL, regAfect
    
    SQL = "CREATE TABLE " & NombreTablaTemp & " "
    SQL = SQL & "(CodigoBarra VARCHAR(15), "
    SQL = SQL & "TipoLista  VARCHAR(3), "
    SQL = SQL & "PrecioLista NUMERIC(24,2), "
    SQL = SQL & "Precio NUMERIC(24,2), "
    SQL = SQL & "Cantidad NUMERIC(24,4), "
    SQL = SQL & "Impuesto NUMERIC(24,4), "
    SQL = SQL & "PorcentajeImpuesto NUMERIC(24,2), "
    SQL = SQL & "Costo NUMERIC(24,2), "
    SQL = SQL & "PorcentajeDescuento Numeric(5,2)) "
    cnnConexion.Execute SQL, regAfect
    WriteLog ("Creacion de tabla temporal " & NombreTablaTemp)
    SQL = "CREATE NONCLUSTERED INDEX [IX_CodigoBarra] ON " & NombreTablaTemp & " ([CodigoBarra])"
    cnnConexion.Execute SQL, regAfect
    
    SQL = "CREATE TABLE " & NombreTablaResult & " "
    SQL = SQL & "(CodigoBarra VARCHAR(15), "
    SQL = SQL & "TipoLista  VARCHAR(3), "
    SQL = SQL & "PrecioLista NUMERIC(24,2), "
    SQL = SQL & "Precio NUMERIC(24,2), "
    SQL = SQL & "Cantidad NUMERIC(24,4), "
    SQL = SQL & "Impuesto NUMERIC(24,4), "
    SQL = SQL & "PorcentajeImpuesto NUMERIC(24,2), "
    SQL = SQL & "Costo NUMERIC(24,2), "
    SQL = SQL & "PorcentajeDescuento Numeric(5,2), "
    SQL = SQL & "IDRegla INT, "
    SQL = SQL & "Regla VARCHAR(15))"
    cnnConexion.Execute SQL, regAfect
    WriteLog ("Creacion de NombreTablaResult")
    SQL = "CREATE NONCLUSTERED INDEX [IX_CodigoBarra] ON " & NombreTablaResult & " ([CodigoBarra])"
    cnnConexion.Execute SQL, regAfect
    
    VItem = 1
    VFila = 1
    SpreadMovimiento.Col = 2
    While VFila <= SpreadMovimiento.DataRowCnt
        SpreadMovimiento.Row = VFila
        SpreadMovimiento.Col = 1
        VTipoLista = SpreadMovimiento.Text
        SpreadMovimiento.Col = 2
        VCodigoBarra = SpreadMovimiento.Text
        SpreadMovimiento.Col = 7
        VPrecioLista = CDbl(SpreadMovimiento.Text)
        SpreadMovimiento.Col = 4
        VPrecio = CDbl(SpreadMovimiento.Text)
        SpreadMovimiento.Col = 5
        VCantidad = CDbl(SpreadMovimiento.Text)
        SpreadMovimiento.Col = 10
        VImpuesto = CDbl(SpreadMovimiento.Text)
        SpreadMovimiento.Col = 12
        VPorcentajeImpuesto = CDbl(SpreadMovimiento.Text)
        SpreadMovimiento.Col = 13
        VCosto = CDbl(SpreadMovimiento.Text)
        SpreadMovimiento.Col = 17
        vPorcentajedescuento = CDbl(SpreadMovimiento.Text)
      
        SQL = "UPDATE " & NombreTablaTemp & " SET Cantidad = Cantidad + " & CorregirComa(VCantidad) & " WHERE CodigoBarra = '" & VCodigoBarra & "' AND TipoLista = '" & VTipoLista & "' AND Precio = " & CorregirComa(VPrecio) & " AND Preciolista = " & CorregirComa(VPrecioLista) & " AND PorcentajeDescuento = " & CorregirComa(vPorcentajedescuento) & " "
        cnnConexion.Execute SQL, regAfect
        
        If regAfect = 0 Then
            SQL = "INSERT INTO " & NombreTablaTemp & " (CodigoBarra, TipoLista, PrecioLista, Precio, Cantidad, Impuesto, PorcentajeImpuesto, Costo, PorcentajeDescuento) "
            'SQL = SQL & "VALUES('" & VCodigoBarra & "','" & IIf(txtPorcentajeDescuento = 0, VTipoLista, "D") & "'," & CorregirComa(VPrecioLista) & "," & CorregirComa(VPrecio) & ", " & CorregirComa(VCantidad) & ", " & CorregirComa(VImpuesto) & ", " & CorregirComa(VPorcentajeImpuesto) & ", " & CorregirComa(VCosto) & "," & CorregirComa(vPorcentajedescuento) & ")"
            SQL = SQL & "VALUES('" & VCodigoBarra & "','" & VTipoLista & "'," & CorregirComa(VPrecioLista) & "," & CorregirComa(VPrecio) & ", " & CorregirComa(VCantidad) & ", " & CorregirComa(VImpuesto) & ", " & CorregirComa(VPorcentajeImpuesto) & ", " & CorregirComa(VCosto) & "," & CorregirComa(vPorcentajedescuento) & ")"
            cnnConexion.Execute SQL
        End If

        VFila = VFila + 1
    Wend
    
    ' validamos las existencias
    SQL = "SELECT tmp.CodigoBarra,i.Nombre,i.Referencia,i.CodigoMarca,sum(tmp.Cantidad) Cantidad, max(i.existencia) Existencia "
    SQL = SQL & "FROM " & NombreTablaTemp & " tmp INNER JOIN inventario i on tmp.codigoBarra=i.codigobarra "
    SQL = SQL & "WHERE i.existencia + " & CorregirComa(CDbl(varMargenAuxiliarDeVenta)) & "<tmp.cantidad  AND i.TIPO= 0 "
    SQL = SQL & "GROUP BY tmp.CodigoBarra,i.nombre,i.referencia,i.codigomarca "
     
    rcsSaldos.Open SQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
     
    If Not rcsSaldos.EOF Then
        frmsaldos.Cargar_ListView rcsSaldos
        Unload frmsaldos
        rcsSaldos.Close
        cmdDescuento.Enabled = True
        cmdCongelar.Enabled = True
        cmdDescongelar.Enabled = True
        cmdSalir.Enabled = True
        cmdCancelar.Enabled = True
        cmdOrdenDespacho.Enabled = True
        cmdListaPrecios.Enabled = True
        cmdPrevisualizar.Enabled = True
        SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
        SpreadMovimiento.SetFocus
        Exit Sub
    End If
    
    rcsSaldos.Close
    
    EsTodoMayor = False
    If fxUtilizaTasaParaMayor Then
        EsTodoMayor = fxEsTodoMayor(SpreadMovimiento)
    End If
    
    Set sqlComando = New ADODB.Command
'    If txtPorcentajeDescuento = 0 Then
        With sqlComando
            .ActiveConnection = cnnConexion
            .CommandText = "PromocionesYOfertas_SelectorDeReglas"
            .CommandType = adCmdStoredProc
            .Parameters.Append .CreateParameter("@TablaFacturacion", adVarChar, adParamInput, 50, NombreTablaTemp)
            .Parameters.Append .CreateParameter("@TablaResultado", adVarChar, adParamInput, 50, NombreTablaResult)
            .Parameters.Append .CreateParameter("@Convenio", adVarChar, adParamInput, 4, varTipoConvenio)
            .Parameters.Append .CreateParameter("@EsCredito", adVarChar, adParamInput, 1, IIf(EsCredito, "S", "N"))
            .Parameters.Append .CreateParameter("@EsMayorista", adVarChar, adParamInput, 1, PermitirVentasCatalogo)
            .Parameters.Append .CreateParameter("@Grupo", adVarChar, adParamInput, 8, varSelector)
            .Execute
        End With
'    Else
'        SQL = "INSERT INTO " & NombreTablaResult & " (CodigoBarra,TipoLista,PrecioLista,Precio,Cantidad,Impuesto,PorcentajeImpuesto,Costo,PorcentajeDescuento,IDRegla,Regla)"
'        SQL = SQL & "SELECT CodigoBarra, 'D',(Precio - (Precio * " & CorregirComa(txtPorcentajeDescuento) & " / 100)), Precio, Cantidad, Impuesto, PorcentajeImpuesto, "
'        SQL = SQL & "Costo, " & CorregirComa(txtPorcentajeDescuento) & ", NULL, NULL FROM " & NombreTablaTemp & ""
'        cnnConexion.Execute SQL
'    End If
    
    SQL = "SELECT R.CodigoBarra, I.Nombre, R.Precio, R.Cantidad, R.PrecioLista, (R.Precio-R.PrecioLista) AS Descuento, " & _
                 "R.Cantidad*(R.Precio-R.PrecioLista) AS TotalDescuento, (R.Cantidad*R.Precio) AS SubTotal, " & _
                 "(R.PrecioLista*R.PorcentajeImpuesto/100) AS Impuesto, R.Cantidad*(R.PrecioLista*R.PorcentajeImpuesto/100) AS TotalImpuesto, " & _
                 "R.PorcentajeImpuesto, I.CostoPromedio AS Costo, (I.CostoPromedio*R.Cantidad) AS TotalCosto, " & _
                 "I.Referencia, I.CodigoMarca, R.PorcentajeDescuento, ISNULL(R.Regla,'') AS Regla, ISNULL(R.IDRegla,0) AS IDRegla, R.TipoLista " & _
          "FROM " & NombreTablaResult & " R " & _
                 "LEFT JOIN dbo.Reglas RE ON R.IDRegla = RE.ID " & _
                 "INNER JOIN dbo.INVENTARIO I ON I.CodigoBarra = R.CodigoBarra"
    
    rcsResultado.Open SQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
    frmReglas.MostrarResultadosReglas rcsResultado, varCedulaVendedor, txtCliente, VarNumeroOrden, _
                                      txtTotalFactura, txtNombreVendedor, False, , , , , , _
                                      0, NombreTablaResult, EsCredito, vCredito, bEsContingencia
    Unload frmReglas
    
    SQL = "DROP TABLE " & NombreTablaTemp
    cnnConexion.Execute SQL
    
    SQL = "DROP TABLE " & NombreTablaResult
    cnnConexion.Execute SQL
    
    cmdDescuento.Enabled = True
    cmdCongelar.Enabled = True
    cmdDescongelar.Enabled = True
    cmdSalir.Enabled = True
    cmdCancelar.Enabled = True
    cmdOrdenDespacho.Enabled = True
    cmdListaPrecios.Enabled = True
    cmdPrevisualizar.Enabled = True
    
    If FacturacionRealizada = True Then
        InicializarSpreads
        InicializarVariables
        MostrarProximaFactura
        Spread.Accion_Spread7 SpreadMovimiento, SpreadMovimiento.DataRowCnt + 1, 2, SpreadMovimiento.DataRowCnt + 1, 2, DESBLOQUEAR
        SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
        txtCliente.SetFocus
        
        If VarUsaImpresoraFiscal = 1 Then
            While ObtenerStatusImpresoraFiscal <> 4
            Wend
            CerrarPuertoImpresoraFiscal
            Call Espera(1)
            If Not AbrirPuertoImpresoraFiscal Then
                WriteLog ("No se pudo abrir el puerto fiscal")
                Unload Me
                Exit Sub
            End If
            If Not ImpresoraEstaLista(2) Then
                varFormaCargada = False
                Unload Me
                Exit Sub
            End If
        End If
    Else
        SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
        SpreadMovimiento.SetFocus
    End If
    
    rcsResultado.Close
    Set rcsResultado = Nothing
    
    Set sqlComando = Nothing
    
End Sub

Private Sub cmdSalir_Click()
    If SpreadMovimiento.DataRowCnt > 0 Then
        If MsgBox("Desea eliminar los datos cargados?", vbQuestion + vbYesNo, "Eliminar item") = vbYes Then
            If EliminarItemRequiereAutorizacion Then
               If Not PermiteEliminarItem Then
                   MsgBox "Ud no esta autorizado para eliminar items de facturacion"
                   Exit Sub
               End If
            End If
            Call registrarItemsBorrados("S")
            Call AsignarFormula
            InicializarSpreads
            InicializarVariables
            Unload Me
        End If
    Else
        Call AsignarFormula
        InicializarSpreads
        InicializarVariables
        Unload Me
    End If
    
End Sub

Private Sub Form_Activate()
    If varFormaCargada = False Then
        Call OcultarMenuPrincipal
        txtCliente.SetFocus
        varFormaCargada = True
    End If
End Sub

Private Sub Form_KeyDown(KeyCode As Integer, Shift As Integer)
    Select Case KeyCode
    Case vbKeyF12
        frmCalculadora.Show
        frmCalculadora.ZOrder 0
        frmCalculadora.Left = 0
        frmCalculadora.Top = 0
    Case vbKeyF2
        frmConsultarPrecios.Show 1
    Case vbKeyF3
        frmConsultarCodigoReglasActivas.Show 1
    End Select
End Sub

Private Sub Form_Load()
Dim ISQL                As String
Dim VarImpresoraFactura As Variant
Dim sHabilitarVisorPrecios As String
   
    varFormaCargada = False
    BotonElegido = ONinguno
    BolCargarDatos = False
    varCambiarPreciosAutorizado = False
    
    WriteLog ("Form_Load - Facturacion")
    
    If Not ValidarApertura Then
        Unload Me
        Exit Sub
    End If
    WriteLog ("Apertura Validada en " & varSerie)
    
    If varListaPrecio <> 3 Then
        cmdListaPrecios.Visible = False
    Else
        If varPermiteAlternarListas = 0 Then
            cmdListaPrecios.Visible = False
        End If
    End If
    
    If varCongelarFacturas = 0 Then
        cmdCongelar.Visible = False
        cmdDescongelar.Visible = False
    End If
    
    cmdCambiarPrecio.Visible = PermiteCambiarPrecios
    
    If varPermiteDescuento = 0 Then
        cmdDescuento.Visible = False
    End If
    
    If varPermiteFacturasExentas = 1 Then
        chkFacturaExentaDeImpuesto.Visible = True
        shpExenta.Visible = True
    End If
    
    If VarFacturarOrdenDespacho = 0 Then
        cmdOrdenDespacho.Visible = False
    End If
    
    If VarUsaImpresoraFiscal = 1 Then
        CerrarPuertoImpresoraFiscal
        If Not AbrirPuertoImpresoraFiscal Then
            WriteLog ("No se pudo abrir el puerto fiscal")
            Unload Me
            Exit Sub
        End If
        If Not ImpresoraEstaLista(2) Then
            varFormaCargada = False
            Unload Me
            Exit Sub
        End If
    Else
        VarImpresoraFactura = fxImpresoraFactura
        If Trim(VarImpresoraFactura) = "" Then
            MsgBox "Debe configurar la impresora para facturar...!", vbInformation, "Información"
            frmConfImpresora.Show 1
            VarImpresoraFactura = fxImpresoraFactura
            WriteLog (": Impresora factura - " & VarImpresoraFactura)
            If Trim(VarImpresoraFactura) = "" Then
                varFormaCargada = False
                Unload Me
                Exit Sub
            End If
        End If
    End If
    Call MostrarProximaFactura
    Call FormatoColSpread7(SpreadMovimiento)

    Call ConfigurarComandos
    Call PrepararClaseSpread
    Call InicializarSpreads
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 5, fxCantidadDecimalesFacturacion, True)
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 7, 2)
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 8, 4)
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 9, 4)
    If VarUsaImpresoraFiscal = 1 Then
        Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 10, 4)
    Else
        Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 10, 4)
    End If
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 11, 4)
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 17, 2)
    SpreadMovimiento.Sheet = 2
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 1, 2)
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 2, 2)
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 3, 2)
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 4, 2)
    Call ConfigurarCantidadesEnSpread(SpreadMovimiento, 5, 2)
    SpreadMovimiento.Sheet = 1
    
    If SucursalPermiteFacturaContingencia Then  'And PerteneceAlGrupoAdministrador(strUsuarioActivo)
        chkFacturaContingencia.Visible = True
        chkFacturaContingencia.Enabled = CajaPermiteFacturaContingencia
        chkFacturaContingencia.Value = Checked
    Else
        chkFacturaContingencia.Visible = False
        chkFacturaContingencia.Enabled = False
        chkFacturaContingencia.Value = False
    End If
    
    Call AsignarFormula
    Call InicializarVariables
    SpreadMovimiento.OperationMode = OperationModeNormal
    SpreadMovimiento.ActiveCellHighlightStyle = ActiveCellHighlightStyleNormal
    Spread.Accion_Spread7 SpreadMovimiento, SpreadMovimiento.DataRowCnt + 1, 2, SpreadMovimiento.DataRowCnt + 1, 2, DESBLOQUEAR
    SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
    'Colocado asi por que casi el 100% de los pagos son electronicos en VZLA
    sHabilitarVisorPrecios = BuscarDescripcionTablaValores("HABILITAR_VISOR_PRECIOS", "01")
    If sHabilitarVisorPrecios = Empty Then
        bHabilitarVisorPrecios = False
    Else
        bHabilitarVisorPrecios = CBool(BuscarDescripcionTablaValores("HABILITAR_VISOR_PRECIOS", "01"))
    End If
   
    Call HabilitarOpcionContingencia
End Sub

Private Sub MostrarProximaFactura()
Dim ISQL             As String
Dim rcsUltimaFactura As ADODB.Recordset
Dim VarUltimaFactura As Long

    If varControlFactura = 1 Then
        Set rcsUltimaFactura = New ADODB.Recordset
        ISQL = "SELECT UltimaFactura FROM CAJAS WHERE Serie = '" & varSerie & "'"
        rcsUltimaFactura.Open ISQL, cnnConexion, adOpenStatic, adLockOptimistic, adCmdText
        If Not rcsUltimaFactura.EOF Then
            VarUltimaFactura = rcsUltimaFactura!UltimaFactura + 1
            gUltimaFactura = VarUltimaFactura
        End If
        Me.Caption = "Facturación - (Factura Nº " + CStr(VarUltimaFactura) + ")" + "                                            (F2 - Consultar Precios)   (F3 - Consultar Reglas Activas) "
        'Facturación                                                                                                             F2 - Consultar Precios                   F3 - Consultar Reglas Activas
        rcsUltimaFactura.Close
        Set rcsUltimaFactura = Nothing
    End If
End Sub

Private Sub Form_Unload(Cancel As Integer)
    If EliminarItemRequiereAutorizacion Then
        If SpreadMovimiento.DataRowCnt > 0 Then
            If Not PermiteEliminarItem Then
                MsgBox "Ud no esta autorizado para eliminar items de facturacion"
                Cancel = True
                Exit Sub
            End If
        End If
    End If
    On Error Resume Next
    Call registrarItemsBorrados("F")
    Unload frmPagosVenta
    Unload frmCmdDlgSpr
    Call VerMenuPrincipal
    Set Spread = Nothing
    Set CatInventario = Nothing
    Set CatCliente = Nothing
    Set CatVendedor = Nothing
    If VarUsaImpresoraFiscal = 1 Then
        Call CloseFpctrl
    End If
End Sub

Private Function DatosCompletos() As Boolean
Dim varTextoSpread As String

    DatosCompletos = True
    If Len(txtCliente) = 0 Then
        MsgBox "Especifique el cliente al que se le realizó la venta...!", vbInformation, "Información"
        txtCliente.SetFocus
        DatosCompletos = False
    ElseIf Len(varCedulaVendedor) = 0 Then
        MsgBox "Debe especificar el vendedor que realizó la venta...!", vbInformation, "Información"
        txtVendedor.SetFocus
        DatosCompletos = False
    ElseIf CDbl(txtTotalFactura) = 0 Then
        MsgBox "Debe especificar al menos un artículo...!", vbInformation, "Información"
        With SpreadMovimiento
            SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
            DatosCompletos = False
        End With
    End If
End Function

Private Function DatosCompletosCongelar() As Boolean
Dim varTextoSpread As String

    DatosCompletosCongelar = True
    If Len(txtCliente) = 0 Then
        MsgBox "Especifique el cliente al que se le realizó la venta...!", vbInformation, "Información"
        txtCliente.SetFocus
        DatosCompletosCongelar = False
    ElseIf Len(varCedulaVendedor) = 0 Then
        MsgBox "Debe especificar el vendedor que realizó la venta...!", vbInformation, "Información"
        txtVendedor.SetFocus
        DatosCompletosCongelar = False
    ElseIf CDbl(txtTotalFactura) = 0 Then
        MsgBox "Debe especificar al menos un artículo...!", vbInformation, "Información"
        With SpreadMovimiento
            SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
            DatosCompletosCongelar = False
        End With
    End If
End Function

Private Sub ConfigurarComandos()
    If PermiteReferenciaMarca Then
        ISQL = "SELECT CodigoBarra, Referencia, INVENTARIO.Nombre, Existencia, "
        ISQL = ISQL & "ROUND(PrecioDetal, 2) as [~HDN1], PrecioMayor as [~HDN2], PrecioAfiliado as [~HDN3], "
        ISQL = ISQL & "PorcentajeImpuesto as [~HDN4], CostoPromedio as [~HDN5], Promocion as [~HDN6], PrecioPromocion as [~HDN7],"
        ISQL = ISQL & "FechaInicial as [~HDN8], FechaFinal as [~HDN9],CodigoMarca as [~HDN10],Tipo as [~HDN11] "
        ISQL = ISQL & "FROM INVENTARIO INNER JOIN IMPUESTOS ON TipoImpuesto = Codigo "
        ISQL = ISQL & "WHERE (CodigoBarra=? OR Referencia+CodigoMarca+Talla+CodigoColor+INVENTARIO.Nombre LIKE ? ) AND Existencia > 0- " & CorregirComa(CDbl(varMargenAuxiliarDeVenta)) & " AND Status = 1 "
        ISQL = ISQL & "AND CodigoBarra NOT LIKE 'TREGALO_%' "
        ISQL = ISQL & "ORDER BY CodigoBarra"
    Else
        ISQL = "SELECT CodigoBarra, Referencia, INVENTARIO.Nombre, Existencia, "
        ISQL = ISQL & "ROUND(PrecioDetal, 2) as [~HDN1], PrecioMayor as [~HDN2], PrecioAfiliado as [~HDN3], "
        ISQL = ISQL & "PorcentajeImpuesto as [~HDN4], CostoPromedio as [~HDN5], Promocion as [~HDN6], PrecioPromocion as [~HDN7],"
        ISQL = ISQL & "FechaInicial as [~HDN8], FechaFinal as [~HDN9],CodigoMarca as [~HDN10],Tipo as [~HDN11] "
        ISQL = ISQL & "FROM INVENTARIO INNER JOIN IMPUESTOS ON TipoImpuesto = Codigo "
        ISQL = ISQL & "WHERE (CodigoBarra=?) AND Existencia > 0- " & CorregirComa(CDbl(varMargenAuxiliarDeVenta)) & " AND Status = 1 "
        ISQL = ISQL & "AND CodigoBarra NOT LIKE 'TREGALO_%' "
        ISQL = ISQL & "ORDER BY CodigoBarra"
    End If
    
    If bLecturaBalanza Then
        ISQL = "SELECT CodigoBarra, Referencia, INVENTARIO.Nombre, Existencia, "
        ISQL = ISQL & "ROUND(PrecioDetal, 2) as [~HDN1], PrecioMayor as [~HDN2], PrecioAfiliado as [~HDN3], "
        ISQL = ISQL & "PorcentajeImpuesto as [~HDN4], CostoPromedio as [~HDN5], Promocion as [~HDN6], PrecioPromocion as [~HDN7],"
        ISQL = ISQL & "FechaInicial as [~HDN8], FechaFinal as [~HDN9],CodigoMarca as [~HDN10],Tipo as [~HDN11] "
        ISQL = ISQL & "FROM INVENTARIO INNER JOIN IMPUESTOS ON TipoImpuesto = Codigo "
        ISQL = ISQL & "WHERE (CodigoBarra=?) AND Existencia > 0- " & CorregirComa(CDbl(varMargenAuxiliarDeVenta)) & " AND Status = 1 "
        ISQL = ISQL & "AND CodigoBarra NOT LIKE 'TREGALO_%' "
        ISQL = ISQL & "ORDER BY CodigoBarra"
    End If

    CatInventario.CommandType = adCmdText
    CatInventario.Prepared = True
    CatInventario.CommandText = ISQL
    CatInventario.ActiveConnection = cnnConexion
        
    ISQL = "SELECT C.Codigo, C.Nombre, C.Celular, C.Direccion, C.Tipo as [~HDN1], C.TipoContribuyente as [~HDN2],C.PorcentajeUtilidad as [~HDN3],T.Descripcion as [~HDN4] FROM CLIENTES C INNER JOIN TIPOSCLIENTE T ON C.Tipo=T.Codigo "
    ISQL = ISQL & " WHERE C.Codigo LIKE ? AND C.Status=1 ORDER BY C.Codigo;"
    CatCliente.CommandType = adCmdText
    CatCliente.Prepared = True
    CatCliente.CommandText = ISQL
    CatCliente.ActiveConnection = cnnConexion
        
    ISQL = "SELECT Codigo,Nombre, Cedula FROM TRABAJADORES WHERE Cargo ='003' AND Status=1 ORDER BY Codigo;"
    CatVendedor.CommandType = adCmdText
    CatVendedor.Prepared = True
    CatVendedor.CommandText = ISQL
    CatVendedor.ActiveConnection = cnnConexion
End Sub

Private Sub PrepararClaseSpread()
    Set Spread = New clsSpread
    Spread.NombreSpreadACargar = SpreadMovimiento
End Sub

Private Sub InicializarVariables()
    txtCliente.Enabled = True
    cmdClientes.Enabled = True
    chkFacturaExentaDeImpuesto.Enabled = True
    chkFacturaExentaDeImpuesto.Value = 0
    lblTipoCliente = ""
    varTipoPrecio = "D"
    VarNumeroOrden = 0
    varMontoFactura = 0
    varMontoDelPago = 0
    txtCliente = Empty: txtNombreCliente = Empty
    txtVendedor = Empty: txtNombreVendedor = Empty
    txtTotalUnidades = Format(0, "###,###,###,##0.00")
    txtTotalMercancia = Format(0, "###,###,###,##0.00")
    txtPorcentajeDescuento = Format(0, "###,###,###,##0.00")
    txtPorcentajeDescuento.Enabled = False
    txtTotalDescuento = Format(0, "###,###,###,##0.00")
    Frame3.Enabled = False
    txtTotalBaseImponible = Format(0, "###,###,###,##0.00")
    txtTotalImpuesto = Format(0, "###,###,###,##0.00")
    txtTotalFactura = Format(0, "###,###,###,##0.00")
    txtTotalCosto = Format(0, "###,###,###,##0.00")
    chkFacturaContingencia.Value = False
    PermiteReferenciaMarca = fxPermiteReferenciaMarca
    cmdPermitirReferenciaMarca.Visible = (Not PermiteReferenciaMarca)
    SpreadMovimiento.OperationMode = OperationModeNormal
    SpreadMovimiento.ActiveCellHighlightStyle = ActiveCellHighlightStyleNormal
    Spread.Accion_Spread7 SpreadMovimiento, SpreadMovimiento.DataRowCnt + 1, 2, SpreadMovimiento.DataRowCnt + 1, 2, DESBLOQUEAR
    SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
    Call HabilitarOpcionContingencia
    intCantidadItemsFactura = 0
    txtTotalUSD.Enabled = False
    txtTotalUSD.Text = Format(0, "###,###,###,##0.00")
End Sub

Private Sub AsignarFormula(Optional ByVal ColFor As Byte = 0)
Dim NumMaxFila As Long
Dim varTotalDescuento As Double

    With SpreadMovimiento
        NumMaxFila = .MaxRows
        .Sheet = 1
        If ColFor = 5 Or ColFor = 4 Or ColFor = 6 Or ColFor = 0 Then
            If VarUsaImpresoraFiscal Then
                OperEntreCol7SubTotal SpreadMovimiento, 1, NumMaxFila, 6, 5, 4, 10, 12
            Else
                OperEntreCol7 SpreadMovimiento, 1, 5, NumMaxFila, 4, 6, "*"
            End If
        End If
        
        If ColFor = 3 Or ColFor = 8 Or ColFor = 12 Or ColFor = 0 Then
            OperEntreCol7ImpuestoItem SpreadMovimiento, 1, NumMaxFila, 4, 8, 12, 10
        End If
        
        If ColFor = 5 Or ColFor = 8 Or ColFor = 9 Or ColFor = 0 Then
            If Not VarUsaImpresoraFiscal Then
                OperEntreCol7 SpreadMovimiento, 1, 5, NumMaxFila, 8, 9, "*"
            End If
        End If
        
        If ColFor = 5 Or ColFor = 10 Or ColFor = 11 Or ColFor = 0 Then
            If VarUsaImpresoraFiscal Then
                OperEntreCol7SubTotalImpuesto SpreadMovimiento, 1, NumMaxFila, 11, 6, 12, 9
            Else
                OperEntreCol7 SpreadMovimiento, 1, 5, NumMaxFila, 10, 11, "*"
            End If
        End If
                
        If ColFor = 5 Or ColFor = 13 Or ColFor = 14 Or ColFor = 0 Then
            OperEntreCol7 SpreadMovimiento, 1, 5, NumMaxFila, 13, 14, "*"
        End If
                
        .Sheet = 2
        If ColFor = 5 Or ColFor = 0 Then   'Total unidades
            .Col = 1: .Row = 1
            .Formula = "SUM(Sheet1!E1:E" & NumMaxFila & ")"
        End If
        If ColFor = 6 Or ColFor = 0 Then   'Total Mercancia
            .Col = 2: .Row = 1
            .Formula = "SUM(Sheet1!F1:F" & NumMaxFila & ")"
        End If
        If ColFor = 10 Or ColFor = 0 Then  'Total Impuesto
            .Col = 3: .Row = 1
            .Formula = "SUM(Sheet1!I1:I" & NumMaxFila & ")"
        End If
        If ColFor = 11 Or ColFor = 0 Then  'Total Impuesto
            .Col = 4: .Row = 1
            .Formula = "SUM(Sheet1!K1:K" & NumMaxFila & ")"
        End If
        If ColFor = 14 Or ColFor = 0 Then  'Total Costo
            .Col = 5: .Row = 1
            .Formula = "SUM(Sheet1!N1:N" & NumMaxFila & ")"
        End If
        .Sheet = 1
        .Row = NumMaxFila
    End With
End Sub

Private Sub AsignarFormula2(Optional ByVal ColFor As Byte = 0)
Dim NumMaxFila As Long
Dim varTotalDescuento As Double

    With SpreadMovimiento
        NumMaxFila = .MaxRows
        .Sheet = 1
        If ColFor = 5 Or ColFor = 4 Or ColFor = 6 Or ColFor = 0 Then
            If VarUsaImpresoraFiscal Then
                OperEntreCol7SubTotal SpreadMovimiento, NumMaxFila, NumMaxFila, 6, 5, 4, 10, 12
            Else
                OperEntreCol7 SpreadMovimiento, 1, 5, NumMaxFila, 4, 6, "*"
            End If
        End If
               
        If ColFor = 5 Or ColFor = 8 Or ColFor = 9 Or ColFor = 0 Then
            If Not VarUsaImpresoraFiscal Then
                OperEntreCol7 SpreadMovimiento, NumMaxFila, 5, NumMaxFila, 8, 9, "*"
            End If
        End If
        
        If ColFor = 5 Or ColFor = 10 Or ColFor = 11 Or ColFor = 0 Then
            If VarUsaImpresoraFiscal Then
                OperEntreCol7SubTotalImpuesto SpreadMovimiento, NumMaxFila, NumMaxFila, 11, 6, 12, 9
            Else
                OperEntreCol7 SpreadMovimiento, 1, 5, NumMaxFila, 10, 11, "*"
            End If
        End If
                
        If ColFor = 5 Or ColFor = 13 Or ColFor = 14 Or ColFor = 0 Then
            OperEntreCol7 SpreadMovimiento, NumMaxFila, 5, NumMaxFila, 13, 14, "*"
        End If
                
        .Sheet = 2
        If ColFor = 5 Or ColFor = 0 Then   'Total unidades
            .Col = 1: .Row = 1
            .Formula = "SUM(Sheet1!E1:E" & NumMaxFila & ")"
        End If
        
        If ColFor = 6 Or ColFor = 0 Then   'Total Mercancia
            .Col = 2: .Row = 1
            .Formula = "SUM(Sheet1!F1:F" & NumMaxFila & ")"
        End If
        
        If ColFor = 10 Or ColFor = 0 Then  'Total Impuesto
            .Col = 3: .Row = 1
            .Formula = "SUM(Sheet1!I1:I" & NumMaxFila & ")"
        End If
        
        If ColFor = 11 Or ColFor = 0 Then  'Total Impuesto
            .Col = 4: .Row = 1
            .Formula = "SUM(Sheet1!K1:K" & NumMaxFila & ")"
        End If
        
        If ColFor = 14 Or ColFor = 0 Then  'Total Costo
            .Col = 5: .Row = 1
            .Formula = "SUM(Sheet1!N1:N" & NumMaxFila & ")"
        End If
        
        .Sheet = 1
        .Row = NumMaxFila
    End With
End Sub

Private Sub MostrarTotales(Optional ByVal ColFor As Byte = 0)
Dim i           As Long
Dim SubTotalMer As Double
Dim SubTotalDes As Double
Dim SubTotalImp As Double

    With SpreadMovimiento
        .Sheet = 2
        If ColFor = 5 Or ColFor = 0 Then 'Cantidad
            .Col = 1: .Row = 1
            txtTotalUnidades.Text = Format(IIf(.Text = "", 0, .Text), "###,###,###,##0.00")
        End If
        
        If ColFor = 6 Or ColFor = 0 Then 'Total Mercancia
            .Col = 2: .Row = 1
            txtTotalMercancia.Text = Format(IIf(.Text = "", 0, .Text), "###,###,###,##0.00")
        End If
        
        If ColFor = 9 Or ColFor = 0 Then 'Total Descuento
            .Col = 3: .Row = 1
            txtTotalDescuento.Text = Format(IIf(.Text = "", 0, .Text), "###,###,###,##0.00")
        End If

        If ColFor = 11 Or ColFor = 0 Then 'Total Impuesto
            .Col = 4: .Row = 1
            txtTotalImpuesto.Text = Format(IIf(.Text = "", 0, .Text), "###,###,###,##0.00")
        End If
        
        If ColFor = 14 Or ColFor = 0 Then 'Total Costo
            .Col = 5: .Row = 1
            txtTotalCosto.Text = Format(IIf(.Text = "", 0, .Text), "###,###,###,##0.00")
        End If
        
        .Sheet = 1
    End With
    
    SubTotalMer = 0
    SubTotalImp = 0
    SubTotalDes = 0
    If SpreadMovimiento.DataRowCnt > 0 Then
        For i = 1 To SpreadMovimiento.DataRowCnt
            With SpreadMovimiento
                .Row = i
                .Col = 6 'SubTotalMercancia
                SubTotalMer = SubTotalMer + Format(IIf(.Text = "", 0, .Text), "###,###,###,##0.00")
                .Col = 9 'SubTotalDescuento
                SubTotalDes = SubTotalDes + Format(IIf(.Text = "", 0, .Text), "###,###,###,##0.00")
                .Col = 11 'SubTotalImpuesto
                SubTotalImp = SubTotalImp + Format(IIf(.Text = "", 0, .Text), "###,###,###,##0.00")
            End With
        Next i
    End If
    
    If CDbl(txtTotalMercancia.Text) <> 0 Then
        txtPorcentajeDescuento.Text = Format(CDbl(txtTotalDescuento.Text) / CDbl(txtTotalMercancia.Text) * 100, "###,###,###,##0.00")
    Else
        txtPorcentajeDescuento.Text = Format(0, "###,###,###,##0.00")
    End If
    
    If CDbl(txtPorcentajeDescuento.Text) > 0 Then
        txtTotalDescuento.Text = Round(CDbl(txtTotalMercancia.Text) * (CDbl(txtPorcentajeDescuento.Text) / 100) + 0.001, 1)
        txtTotalDescuento.Text = Format(txtTotalDescuento.Text, "###,###,###,##0.00")
    End If
    
    txtTotalMercancia.Text = Format(SubTotalMer, "###,###,###,##0.00")
    txtTotalDescuento.Text = Format(SubTotalDes, "###,###,###,##0.00")
    txtTotalImpuesto.Text = Format(SubTotalImp, "###,###,###,##0.00")
    
    txtTotalBaseImponible.Text = Format(CDbl(txtTotalMercancia.Text) - CDbl(txtTotalDescuento.Text), "###,###,###,##0.00")
    txtTotalFactura.Text = Format(Round(CDbl(txtTotalBaseImponible.Text) + CDbl(txtTotalImpuesto.Text), 2), "###,###,###,##0.00")
    varMontoFactura = txtTotalFactura.Text
    If fxUtilizaTasaParaMayor And fxEsTodoMayor(SpreadMovimiento) Then
        txtTotalUSD.Text = Format(varMontoFactura / CDbl(fxTasaMayor), "###,###,###,##0.00")
    Else
        txtTotalUSD.Text = Format(varMontoFactura / fxTasaCambio, "###,###,###,##0.00")
    End If
    txtTotalUSD.Enabled = False
    
'    If VarUsaImpresoraFiscal Then
'        If Abs(Round(CDbl(txtTotalFactura.Text), 0) - varMontoFactura) < 0.02 And Abs((Round(CDbl(txtTotalFactura.Text), -------.......0) - varMontoFactura)) > 0 Then
'            txtTotalFactura.Text = Format(Round(CDbl(txtTotalBaseImponible.Text) + CDbl(txtTotalImpuesto.Text), 0), "###,###,###,##0.00")
'            varMontoFactura = txtTotalFactura.Text
'        ElseIf CDbl(txtPorcentajeDescuento.Text) = 0 Then
'            txtTotalFactura.Text = Format(Round(CDbl(txtTotalBaseImponible.Text) + CDbl(txtTotalImpuesto.Text), 1), "###,###,###,##0.00")
'            varMontoFactura = txtTotalFactura.Text
'        End If
'    End If
End Sub

Private Sub Frame2_DragDrop(Source As Control, X As Single, Y As Single)

End Sub

Private Sub smxPopUpMain_Click(ByVal ID As Long)
    Select Case smxPopUpMain.MenuItems.key(ID)
    Case "BuscarV"
        Call SPR7_BuscarValor2(SpreadMovimiento, ColDef)
        SpreadMovimiento.SetFocus
    Case "IrAFila"
        Call SPR7_IrAFila(SpreadMovimiento, SpreadMovimiento.DataRowCnt)
        SpreadMovimiento.SetFocus
    End Select
End Sub

Private Sub SpreadMovimiento_EditMode(ByVal Col As Long, ByVal Row As Long, ByVal mode As Integer, ByVal ChangeMade As Boolean)
Dim varCantidad             As Double
Dim ValorUnidad             As Double
Dim TotalItemConImpuesto    As Double
Dim VPrecio                 As Double
Dim VDecimalPeso            As Single

    With SpreadMovimiento
        Select Case Col
        Case 2 ' Columna CodigoBarra
            If ChangeMade = True And mode = 0 Then  '=== Que haga cambios y se pierda el focus
                .Col = 1: .Row = Row
                If Trim(txtNombreCliente) = "" Then
                    .Col = 2: .Row = Row
                    .Text = ""
                    MsgBox "Especifique el cliente al que se le realizára la venta...!", vbInformation, "Información"
                    txtCliente.SetFocus
                    Exit Sub
                End If
                If CargarDatosCatalogo(Col, Row, TotalItemConImpuesto) Then
                    SpreadMovimiento.SetFocus
                    .Col = 5: .Row = Row
                    Spread.Accion_Spread7 SpreadMovimiento, Row, 5, Row, 5, DESBLOQUEAR
                    .Text = IIf(dPesoBalanza <> 0, dPesoBalanza, 1)
                    If varCambiarPreciosAutorizado Then
                        Spread.Accion_Spread7 SpreadMovimiento, Row, 4, Row, 4, DESBLOQUEAR
                    End If
                    Spread.Accion_Spread7 SpreadMovimiento, Row, 5, Row, 5, DESBLOQUEAR 'Cantidad
                    Call RecalcularLinea(SpreadMovimiento, SpreadMovimiento.Row, 4, 5, 12, 11, 6, 7, 8, 9, 10, 17)
                    Call MostrarTotales
                    Spread.Accion_Spread7 SpreadMovimiento, Row, 2, Row, 2, BLOQUEAR
                    If .Row = .MaxRows Then
                        Call InsertarFila
                    End If
                    If VarUsaImpresoraFiscal = 1 And bHabilitarVisorPrecios Then
                        .Col = 3
                        Call MostrarMensaje(Mid(.Text, 1, 20), SUPERIOR)
                        If Len("P:" & Format(TotalItemConImpuesto, "#0.00") & " " & "SUB:" & txtTotalFactura.Text) >= 20 Then
                            Call MostrarMensaje("SUB:" & txtTotalFactura.Text & " " & Space(20 - Len("SUB:" & txtTotalFactura.Text)), INFERIOR)
                        Else
                            Call MostrarMensaje("P:" & Format(TotalItemConImpuesto, "#0.00") & " " & "SUB:" & txtTotalFactura.Text & " " & _
                                  Space(20 - Len("P:" & Format(TotalItemConImpuesto, "#0.00") & " " & "SUB:" & txtTotalFactura.Text)), INFERIOR)
                        End If
                    End If
                    If Row + 1 <= .MaxRows Then Spread.Accion_Spread7 SpreadMovimiento, Row + 1, 2, Row + 1, 2, DESBLOQUEAR
                    SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
                    SpreadMovimiento.SetFocus
                Else
                    .SetFocus
                    .Col = 2: .Row = Row: .Text = ""
                End If
            End If
        Case 4 'Columna de Precio
            If mode = 0 Then
                .Col = 4: .Row = Row
                If .Text <= 0 Then
                    .Text = 1
                End If
                VPrecio = .Text
                ValorUnidad = .Text
                .Col = 7: .Text = ValorUnidad
                .Col = 8: .Text = 0
                .Col = 9: .Text = 0
                If .Row = .MaxRows Then
                    Call InsertarFila
                End If
                .Col = 4: .Row = Row + 1
                If .Text = "" And .Row <= .MaxRows Then   'Si se va a agregar una nueva Fila
                    If BotonElegido = 1 Then
                        Spread.Accion_Spread7 SpreadMovimiento, Row + 1, 1, Row + 1, 1, DESBLOQUEAR
                    End If
                    .SetActiveCell 2, Row + 1
                    .Col = 1: .Row = Row + 1
                Else                                      'Si se va a editar en una fila que ya existe
                    Spread.Accion_Spread7 SpreadMovimiento, Row + 1, 4, Row + 1, 4, DESBLOQUEAR
                    .SetActiveCell 5, Row
                End If
                .Col = 7: .Row = Row
                .Text = VPrecio
                .Row = Row
                Call RecalcularLinea(SpreadMovimiento, SpreadMovimiento.Row, 4, 5, 12, 11, 6, 7, 8, 9, 10, 17)
                If ChangeMade = True Then Call MostrarTotales
                If VarUsaImpresoraFiscal Then Call MostraPrecioPorCantidadEnFiscalizador(SpreadMovimiento, Row)
            End If
        Case 5  ' Columna Cantidad
            If mode = 0 Then
                .Col = 5: .Row = Row
                If .Text <= 0 Then
                    .Text = 1
                End If
                
                If .Row = .MaxRows Then
                    Call InsertarFila
                End If
                
                .Col = 5: .Row = Row + 1
                If .Text = "" And .Row <= .MaxRows Then   'Si se va a agregar una nueva Fila
                    If BotonElegido = 1 Then
                        Spread.Accion_Spread7 SpreadMovimiento, Row + 1, 1, Row + 1, 1, DESBLOQUEAR
                    End If
                    .SetActiveCell 2, Row + 1
                    .Col = 1: .Row = Row + 1
                Else                                      'Si se va a editar en una fila que ya existe
                    Spread.Accion_Spread7 SpreadMovimiento, Row + 1, 5, Row + 1, 5, DESBLOQUEAR
                    .SetActiveCell 5, Row + 1
                End If
                
                Call RecalcularLinea(SpreadMovimiento, SpreadMovimiento.Row, 4, 5, 12, 11, 6, 7, 8, 9, 10, 17)
                If ChangeMade = True Then Call MostrarTotales
                If VarUsaImpresoraFiscal Then Call MostraPrecioPorCantidadEnFiscalizador(SpreadMovimiento, Row)
            End If
        End Select
    End With
    Call BloquearDesbloquearCliente
    Call RecalcularLinea(SpreadMovimiento, SpreadMovimiento.Row, 4, 5, 12, 11, 6, 7, 8, 9, 10, 17)
    Call MostrarTotales
End Sub

Private Sub BloquearDesbloquearCliente()
    If SpreadMovimiento.DataRowCnt > 0 Then
        txtCliente.Enabled = False
        cmdClientes.Enabled = False
        chkFacturaExentaDeImpuesto.Enabled = False
    Else
        txtCliente.Enabled = True
        cmdClientes.Enabled = True
        chkFacturaExentaDeImpuesto.Enabled = True
    End If
End Sub

Private Sub InicializarSpreads()
    Spread.Accion_Spread7 SpreadMovimiento, SpreadMovimiento.MaxRows, 1, SpreadMovimiento.MaxRows, 1, MOSTRARCOLUMNA
    Spread.Accion_Spread7 SpreadMovimiento, 1, 1, SpreadMovimiento.MaxRows, SpreadMovimiento.MaxCols, LIMPIAR
    Spread.Accion_Spread7 SpreadMovimiento, 1, 1, SpreadMovimiento.MaxRows, SpreadMovimiento.MaxCols, BLOQUEAR
    ColorFondo7 SpreadMovimiento, 1, 1, SpreadMovimiento.MaxRows, SpreadMovimiento.MaxCols, SPR_COLOR_BLANCO
End Sub

Private Sub InsertarFila()
    With SpreadMovimiento
        .MaxRows = .MaxRows + 1
        Call FormatoColSpread7(SpreadMovimiento)
        Spread.Accion_Spread7 SpreadMovimiento, .MaxRows, 1, .MaxRows, .MaxCols, BLOQUEAR
        Spread.Accion_Spread7 SpreadMovimiento, .MaxRows, 1, .MaxRows, 1, DESBLOQUEAR
        .OperationMode = OperationModeNormal
    End With
    Call AsignarFormula
    Call MostrarTotales
End Sub

Private Sub SpreadMovimiento_KeyDown(KeyCode As Integer, Shift As Integer)
Dim Row, Col As Long

    Select Case KeyCode
    Case vbKeyI
        If Shift = 2 Then
            Call InsertarFila
        End If
    Case vbKeyDelete '=== Presiono el boton suprimir para eliminar una fila
        SpreadMovimiento.Col = 2
        Row = SpreadMovimiento.ActiveRow
        
        SpreadMovimiento.Row = SpreadMovimiento.ActiveRow
        If Trim(SpreadMovimiento.Text) <> "" And Not SpreadMovimiento.EditMode Then
            If MsgBox("Desea eliminar el item seleccionado?", vbQuestion + vbYesNo, "Eliminar item") = vbYes Then
                If EliminarItemRequiereAutorizacion Then
                   If Not PermiteEliminarItem Then
                       MsgBox "Ud no esta autorizado para eliminar items de facturacion"
                       Exit Sub
                   End If
                End If
                Call registrarItemBorrados
                SpreadMovimiento.DeleteRows Row, 1
                Call AsignarFormula2
                
                Row = 1
                While Row <= SpreadMovimiento.DataRowCnt
                    Call RecalcularLinea(SpreadMovimiento, Row, 4, 5, 12, 11, 6, 7, 8, 9, 10, 17)
                    Row = Row + 1
                Wend

                Call MostrarTotales
            End If
            SpreadMovimiento.SetFocus
        End If
        Call BloquearDesbloquearCliente
    Case vbKeyEscape '=== Presiono la tecla Escape
        If cmdPrevisualizar.Enabled Then
            cmdPrevisualizar.SetFocus
        End If
    End Select
End Sub

Private Function CargarDatosCatalogo(ByVal Columna As Long, ByVal Fila As Long, ByRef SubTotalItem As Double) As Boolean
Dim IDProd As String
Dim Campo_Captado As Variant
Dim vPorcentajedescuento As String
Dim intCodigoDesde As Integer
Dim intCodigoHasta As Integer
Dim sIdProductoDesde As String
Dim sIdProductoBalanza As String
Dim sProductoPeso As String
Dim sPeso As String

Dim varListaAnterior    As String
On Error GoTo EscribirLOG

    bLecturaBalanza = False
    Set dicConfiguracionBalanza = CargarInformacionBalanzaDigital
    With SpreadMovimiento
        CargarDatosCatalogo = True
        .Col = Columna: .Row = Fila
        IDProd = Trim(.Text)
        dPesoBalanza = 0
        
        If IDProd = "" Then
            CargarDatosCatalogo = False: Exit Function
        End If
        
        If CBool(dicConfiguracionBalanza.Item("HabilitarBalanza")) = True Then
            If (Len(IDProd) = CInt(dicConfiguracionBalanza.Item("MaximoCaracteres"))) Then
                intCodigoDesde = CInt(dicConfiguracionBalanza.Item("CodigoDesde"))
                intCodigoHasta = CInt(dicConfiguracionBalanza.Item("CodigoHasta"))
                sIdProductoDesde = Mid(IDProd, 1, Len(CStr(dicConfiguracionBalanza.Item("CodigoDesde"))))
                If (CInt(sIdProductoDesde) >= intCodigoDesde And CInt(sIdProductoDesde) <= intCodigoHasta) Then
                    sIdProductoBalanza = Mid(IDProd, Len(dicConfiguracionBalanza.Item("CodigoDesde")) + 1, CInt(dicConfiguracionBalanza.Item("LongitudCodigoBarra")))
                    sProductoPeso = Mid(IDProd, CInt(dicConfiguracionBalanza.Item("CantidadDesde")), CInt(dicConfiguracionBalanza.Item("CantidadHasta")))
                    sPeso = Mid(sProductoPeso, 1, Len(sProductoPeso) - CInt(dicConfiguracionBalanza.Item("CantidadDecimal"))) + "," + Right(sProductoPeso, CInt(dicConfiguracionBalanza.Item("CantidadDecimal")))
                    dPesoBalanza = CDbl(sPeso)
                    bLecturaBalanza = True
                    Call ConfigurarComandos
                    Campo_Captado = BuscarEnCatalogo(CatInventario, sIdProductoBalanza)
                    If Campo_Captado(1) = "" Then
                        CargarDatosCatalogo = False: Exit Function
                    End If
                End If
            End If
        End If
        
        If Not bLecturaBalanza Then
            Call ConfigurarComandos
            If PermiteReferenciaMarca Then
                If fxBuscarArticuloPorNombre Then
                    Campo_Captado = BuscarEnCatalogo(CatInventario, IDProd, "%" & IDProd & "%")
                Else
                    Campo_Captado = BuscarEnCatalogo(CatInventario, IDProd, IDProd & "%")
                End If
            Else
                Campo_Captado = BuscarEnCatalogo(CatInventario, IDProd)
            End If
            If Campo_Captado(1) = "" Then
                CargarDatosCatalogo = False: Exit Function
            End If
        End If
        
        bLecturaBalanza = False
        
        VarPrecioFactura = 0
        VarPrecioLista = 0
        varTipoPrecio = "D"
        
        If VarItemsPorFactura <> 0 Then
            If Not ValidarItemsPorFactura(SpreadMovimiento, Campo_Captado(2), 15, Campo_Captado(14), 16) Then CargarDatosCatalogo = False: Exit Function
        End If
        
        If Campo_Captado(10) Then  'Si el articulo esta en promoción
            If CDate(Campo_Captado(12)) <= Date And CDate(Campo_Captado(13)) >= Date Then
                varTipoPrecio = "P"
                VarPrecioFactura = Campo_Captado(5) 'Precio Detal
                VarPrecioLista = Campo_Captado(11) 'Precio Promoción
            End If
        Else
            If varTipoPrecio = "P" Then
                If varListaPrecio = 1 Or varListaPrecio = 3 Then
                    varTipoPrecio = "D"
                Else
                    varTipoPrecio = "M"
                End If
            End If
        End If
        
        varListaAnterior = varTipoPrecio
        
        If SpreadMovimiento.DataRowCnt = 1 Then
            Select Case varTipoCliente
            Case 2
                varTipoPrecio = "A"  'Precio Cliente Afiliado
            Case 3
                varTipoPrecio = "E"  'Precio Cliente Especial
            Case 4
                varTipoPrecio = "M"  'Precio Cliente Mayorista
            End Select
            varListaAnterior = varTipoPrecio
        Else
            If varListaAnterior <> "P" Then
                SpreadMovimiento.Row = SpreadMovimiento.Row - 1
                SpreadMovimiento.Col = 1
                varListaAnterior = SpreadMovimiento.Text
                SpreadMovimiento.Row = SpreadMovimiento.Row + 1
            End If
        End If
        
        If varListaAnterior <> "P" Then
            varTipoPrecio = varListaAnterior
        End If
    
        Select Case varListaPrecio
        Case 1 'Precio Detal
            Select Case varTipoPrecio
            Case "D"
                VarPrecioFactura = Campo_Captado(5)
                VarPrecioLista = Campo_Captado(5)
            Case "A"
                VarAfiliadoEspecial = True
                VarPrecioFactura = Campo_Captado(7)
                VarPrecioLista = Campo_Captado(7)
            Case "E"
                VarAfiliadoEspecial = True
                VarPrecioFactura = Format(Campo_Captado(9) + (Campo_Captado(9) * (varPorcentajeUtilidad / 100)), "########0.00")
                VarPrecioLista = Format(Campo_Captado(9) + (Campo_Captado(9) * (varPorcentajeUtilidad / 100)), "########0.00")
            End Select
        Case 2 'Precio mayor
            Select Case varTipoPrecio
            Case "M"
                VarPrecioFactura = Campo_Captado(6)
                VarPrecioLista = Campo_Captado(6)
            Case "A"
                VarAfiliadoEspecial = True
                VarPrecioFactura = Campo_Captado(7)
                VarPrecioLista = Campo_Captado(7)
            Case "E"
                VarAfiliadoEspecial = True
                VarPrecioFactura = Format(Campo_Captado(9) + (Campo_Captado(9) * (varPorcentajeUtilidad / 100)), "########0.00")
                VarPrecioLista = Format(Campo_Captado(9) + (Campo_Captado(9) * (varPorcentajeUtilidad / 100)), "########0.00")
            End Select
        Case 3 'Todas las Listas
            Select Case varTipoPrecio
            Case "D"
                VarPrecioFactura = Campo_Captado(5)
                VarPrecioLista = Campo_Captado(5)
            Case "M"
                VarPrecioFactura = Campo_Captado(6)
                VarPrecioLista = Campo_Captado(6)
            Case "A"
                VarAfiliadoEspecial = True
                VarPrecioFactura = Campo_Captado(7)
                VarPrecioLista = Campo_Captado(7)
            Case "E"
                VarAfiliadoEspecial = True
                VarPrecioFactura = Format(Campo_Captado(9) + (Campo_Captado(9) * (varPorcentajeUtilidad / 100)), "########0.00")
                VarPrecioLista = Format(Campo_Captado(9) + (Campo_Captado(9) * (varPorcentajeUtilidad / 100)), "########0.00")
            End Select
        End Select
        
        If Campo_Captado(15) = 1 And Not VarAfiliadoEspecial Then ' si es servicio
            VarPrecioFactura = Campo_Captado(5)
            VarPrecioLista = Campo_Captado(5)
            varTipoPrecio = "D"
        End If
        
        If Campo_Captado(9) = 0 And Campo_Captado(15) = 0 Then
            CargarDatosCatalogo = False
            MsgBox "No se puede vender el artículo con costo cero...!", vbInformation, "Información"
            Exit Function
        End If
        
        If VarPrecioFactura = 0 Then
            CargarDatosCatalogo = False
            MsgBox "No se puede vender el artículo con precio cero...!", vbInformation, "Información"
            Exit Function
        End If
        
        If Campo_Captado(4) <= 0 And Campo_Captado(15) = 0 Then
             ColorFondo7 SpreadMovimiento, Fila, 1, Fila, SpreadMovimiento.MaxCols, SPR_COLOR_MORADO
            'MsgBox "Artículo con existencia en cero...!", vbInformation, "Información"
        End If
        
        If (VarPrecioFactura > VarPrecioLista) And (VarPrecioLista > 0) Then
            VarDescuento = VarPrecioFactura - VarPrecioLista
        Else
            VarDescuento = 0
        End If
        
        .Row = Fila: .Col = 1 'Tipo Lista de Precio
        .Text = varTipoPrecio
        .Row = Fila: .Col = 2 'Codigo Barra
        .Text = Campo_Captado(1)
         varCodigoBarra = Campo_Captado(1)
        .Row = Fila: .Col = 3 'Nombre
        .Text = Campo_Captado(3)
        .Row = Fila: .Col = 4 'Precio factura
        .Text = VarPrecioFactura
        .Row = Fila: .Col = 7 'Precio Lista
        .Text = VarPrecioLista
        .Row = Fila: .Col = 8 'Descuento
        .Text = VarDescuento
        If VarUsaImpresoraFiscal Then
            .Row = Fila: .Col = 9 'TotalDescuento
            vPorcentajedescuento = Round((VarDescuento / VarPrecioFactura), 2)
            .Formula = "F" & Fila & "*" & CorregirComa(CStr(vPorcentajedescuento))
        End If
        
        .Row = Fila: .Col = 10 'Impuesto
        If chkFacturaExentaDeImpuesto.Value Then ' si la factura completa es exenta de impuesto
            .Text = "0"
        Else
            If VarUsaImpresoraFiscal Then
                .Text = Round((VarPrecioFactura - VarDescuento) * (Campo_Captado(8) / 100), 2)
            Else
                .Text = (VarPrecioFactura - VarDescuento) * (Campo_Captado(8) / 100)
            End If
        End If
        
        .Row = Fila: .Col = 12 'Porcentaje Impuesto
        If chkFacturaExentaDeImpuesto.Value Then ' si la factura completa es exenta de impuesto
            .Text = "0"
            Else
            .Text = Campo_Captado(8)
        End If
        
        .Row = Fila: .Col = 13 'Costo
        .Text = Campo_Captado(9)
        .Row = Fila: .Col = 15 'Referencia
        .Text = Campo_Captado(2)
        .Row = Fila: .Col = 16 'CodigoMarca
        .Text = Campo_Captado(14)
        SubTotalItem = VarPrecioLista + (VarPrecioFactura - VarDescuento) * (Campo_Captado(8) / 100)
        
        If VarUsaImpresoraFiscal = 1 Then 'para mostrar mensaje en el visor
            Call MostrarMensaje(Mid(Campo_Captado(3), 1, 20), SUPERIOR)
            Call MostrarMensaje(Format(VarPrecioLista + (VarPrecioFactura - VarDescuento) * (Campo_Captado(8) / 100), "#0.00") & " " & varSimboloMoneda & " " & Space(20 - Len(Format(VarPrecioLista + (VarPrecioFactura - VarDescuento) * (Campo_Captado(8) / 100), "#0.00") & " " & varSimboloMoneda)), INFERIOR)
        End If
        
    End With
    Exit Function
EscribirLOG:
    WriteLog ("Error: " & Err.Description)

End Function

Private Sub SpreadMovimiento_LeaveCell(ByVal Col As Long, ByVal Row As Long, ByVal NewCol As Long, ByVal NewRow As Long, Cancel As Boolean)
Dim VarFila             As Variant
Dim varcostotoal        As Variant
Dim vartipolista        As Variant
Dim VarPrecioLista      As Variant
Dim varTotalImpuesto    As Variant
Dim varCantidad         As Variant
Dim VarImpuesto         As Variant
    SpreadMovimiento.GetText 1, NewRow, vartipolista
    SpreadMovimiento.GetText 6, NewRow, varcostotoal
    SpreadMovimiento.GetText 12, NewRow, VarFila
    SpreadMovimiento.GetText 7, NewRow, VarPrecioLista
    SpreadMovimiento.GetText 11, NewRow, varTotalImpuesto
    SpreadMovimiento.GetText 10, NewRow, VarImpuesto
    SpreadMovimiento.GetText 5, NewRow, varCantidad
    If Len(VarFila) <> Empty Then
        If vartipolista = "P" Or vartipolista = "M" Then
            StatusBar.SimpleText = "Costo Unitario:  " & Format(Round(VarPrecioLista, 2) + Round(VarImpuesto, 2), "###,###,###,##0.00") & " Total: " & Format(Round(VarPrecioLista * varCantidad + varTotalImpuesto, 2), "###,###,###,##0.00")
        Exit Sub
        Else
            txtPorcentajeImpuesto = Format(VarFila, "###,###,###0.00")
            StatusBar.SimpleText = "Precio artículo seleccionado: " & Format(Round(varcostotoal, 2) * Round((1 + Val(VarFila) / 100), 2), "###,###,###,##0.00")
        End If
    Else
        txtPorcentajeImpuesto = Empty
        StatusBar.SimpleText = Empty
    End If
End Sub

Private Sub SpreadMovimiento_RightClick(ByVal ClickType As Integer, ByVal Col As Long, ByVal Row As Long, ByVal MouseX As Long, ByVal MouseY As Long)
    ColDef = Col
    smxPopUpMain.MenuItems.Clear
    Call CargarMenuContextual
    With smxPopUpMain
        .PopupMenu .MenuItems.Key2ID("5100"), _
        .ClientToScreenX(SpreadMovimiento.hwnd, MouseX), _
        .ClientToScreenY(SpreadMovimiento.hwnd, MouseY)
    End With
End Sub

Private Sub txtCliente_Change()
    txtNombreCliente = ""
    lblTipoCliente = ""
End Sub

Private Sub txtCliente_GotFocus()
    SendKeys "{HOME}+{END}"
End Sub

Private Sub txtCliente_KeyPress(KeyAscii As Integer)
    If KeyAscii = 13 Then
        With Me.ActiveControl
        If (.Name = "cmdCancelar") Or (.Name = "cmdSalir") Then Exit Sub
        End With
        If Trim(txtCliente) = "" Then
            cmdClientes_Click
        Else
            Call RegistrarCliente
        End If
    End If
End Sub

Private Sub RegistrarCliente()
Dim rcsCliente As ADODB.Recordset
Dim varRespuesta As Byte
            
    Set rcsCliente = New ADODB.Recordset
    ISQL = "SELECT C.Codigo, C.Nombre, C.Tipo, C.TipoContribuyente,C.PorcentajeUtilidad,T.Descripcion AS TipoCliente FROM CLIENTES C INNER JOIN TIPOSCLIENTE T ON C.Tipo = T.Codigo "
    ISQL = ISQL & " WHERE C.Codigo = '" & txtCliente & "'"
    rcsCliente.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
    If Not rcsCliente.EOF Then
        txtNombreCliente = rcsCliente!Nombre
        varTipoCliente = rcsCliente!tipo
        lblTipoCliente = "CLIENTE TIPO : " & rcsCliente!TIPOCLIENTE
        If fxRequiereActualizarCliente(txtCliente) Then
            frmActualizarCliente.Cedula = txtCliente
            frmActualizarCliente.Show 1
        End If
        Select Case varListaPrecio
        Case 1 'Detal
            If varManejarClientesAfiliadosEspeciales = 1 Then
                If Not (rcsCliente!tipo = 1 Or rcsCliente!tipo = 2 Or rcsCliente!tipo = 3) Then
                    rcsCliente.Close
                    Set rcsCliente = Nothing
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            Else
                If Not (rcsCliente!tipo = 1) Then
                    rcsCliente.Close
                    Set rcsCliente = Nothing
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            End If
        Case 2 'Mayor
            If varManejarClientesAfiliadosEspeciales = 1 Then
                If Not (rcsCliente!tipo = 4 Or rcsCliente!tipo = 2 Or rcsCliente!tipo = 3) Then
                    rcsCliente.Close
                    Set rcsCliente = Nothing
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            Else
                If Not (rcsCliente!tipo = 4) Then
                    rcsCliente.Close
                    Set rcsCliente = Nothing
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            End If
        Case 3 'todas
            If varManejarClientesAfiliadosEspeciales = 0 Then
                If (rcsCliente!tipo = 2 Or rcsCliente!tipo = 3) Then
                    rcsCliente.Close
                    Set rcsCliente = Nothing
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            End If
        End Select
        varTipoContribuyente = rcsCliente!TipoContribuyente
        varPorcentajeUtilidad = rcsCliente!PorcentajeUtilidad
        txtVendedor.SetFocus
    Else
        varRespuesta = MsgBox("El cliente no esta registrado. " & Chr(13) & _
                              "¿Desea Registrarlo?", vbQuestion + vbYesNo + vbDefaultButton1, "Registro de Cliente")
        Select Case varRespuesta
        Case vbYes
            txtNombreCliente.Text = ""
            varCliente = txtCliente
            frmIncClientes.Show 1
            rcsCliente.Close
            Set rcsCliente = Nothing
            Call RegistrarCliente
        Case vbNo
            rcsCliente.Close
            Set rcsCliente = Nothing
            txtCliente.SetFocus
            SendKeys "{HOME}+{END}"
        End Select
    End If
End Sub

Private Sub cmdClientes_Click()
Dim Campo_Captado As Variant

    With Me.ActiveControl
        If (.Name = cmdCancelar.Name) Or (.Name = cmdSalir.Name) Then Exit Sub
    End With
    Campo_Captado = BuscarEnCatalogo(CatCliente, "%")
    If Trim(Campo_Captado(1)) <> "" Then
        txtCliente = Campo_Captado(1)
        txtNombreCliente = Campo_Captado(2)
        varTipoCliente = Campo_Captado(5)
        lblTipoCliente = "CLIENTE TIPO : " & Campo_Captado(8)
        If fxRequiereActualizarCliente(txtCliente) Then
            frmActualizarCliente.Cedula = txtCliente
            frmActualizarCliente.Show 1
        End If
        Select Case varListaPrecio
        Case 1 'Detal
            If varManejarClientesAfiliadosEspeciales = 1 Then
                If Not (varTipoCliente = 1 Or varTipoCliente = 2 Or varTipoCliente = 3) Then
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            Else
                If Not (varTipoCliente = 1) Then
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            End If
        Case 2 'Mayor
            If varManejarClientesAfiliadosEspeciales = 1 Then
                If Not (varTipoCliente = 4 Or varTipoCliente = 2 Or varTipoCliente = 3) Then
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            Else
                If Not (varTipoCliente = 4) Then
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            End If
        Case 3 'todas
            If varManejarClientesAfiliadosEspeciales = 0 Then
                If (varTipoCliente = 2 Or varTipoCliente = 3) Then
                    MsgBox "La caja no esta configurada para facturar a " & lblTipoCliente & "...!", vbInformation, "Información"
                    txtCliente = ""
                    txtCliente.SetFocus
                    Exit Sub
                End If
            End If
        End Select
        
        varNombreCliente = Campo_Captado(2)
        varTipoCliente = Campo_Captado(5)
        varTipoContribuyente = Campo_Captado(6)
        varPorcentajeUtilidad = Campo_Captado(7)
        txtVendedor.SetFocus
    Else
        txtCliente.SetFocus
        txtCliente = ""
        txtNombreCliente = ""
        varNombreCliente = Empty
        varTipoCliente = Empty
        varTipoContribuyente = Empty
        varPorcentajeUtilidad = 0
    End If
End Sub

Private Sub txtNombreCliente_Change()
    If VarUsaImpresoraFiscal = 1 Then
        If Trim(txtNombreCliente) <> "." And Trim(txtNombreCliente) <> "" Then
            Call MostrarMensaje("Bienvenido " & Space(10), SUPERIOR)
            Call MostrarMensaje(Mid(Trim(txtNombreCliente), 1, 20) & Space(20 - Len(Mid(Trim(txtNombreCliente), 1, 20))), INFERIOR)
        Else
            Call MostrarMensaje(Space(20), SUPERIOR)
            Call MostrarMensaje(Space(20), INFERIOR)
        End If
    End If
End Sub

Private Sub txtPorcentajeDescuento_KeyPress(KeyAscii As Integer)
Dim PuntoComa As String

    Select Case KeyAscii
    Case 13
        SendKeys "{TAB}"
    Case Asc("0") To Asc("9"), 8
        KeyAscii = KeyAscii
    Case Asc("."), Asc(",")
        If KeyAscii = Asc(".") And ActualConfgRegional(LOCALE_SDECIMAL) = "," Then
            KeyAscii = Asc(",")
            PuntoComa = ","
        End If
        If KeyAscii = Asc(",") And ActualConfgRegional(LOCALE_SDECIMAL) = "," Then
            KeyAscii = Asc(",")
            PuntoComa = ","
        End If
        If KeyAscii = Asc(",") And ActualConfgRegional(LOCALE_SDECIMAL) = "." Then
            KeyAscii = Asc(".")
            PuntoComa = "."
        End If
        If KeyAscii = Asc(".") And ActualConfgRegional(LOCALE_SDECIMAL) = "." Then
            KeyAscii = Asc(".")
            PuntoComa = "."
        End If
        If InStr(txtPorcentajeDescuento, PuntoComa) <> 0 Then
            KeyAscii = 0
        End If
    Case Else
        KeyAscii = 0
    End Select
End Sub

Private Sub txtVendedor_Change()
    txtNombreVendedor = ""
    varCedulaVendedor = ""
End Sub

Private Sub txtVendedor_KeyPress(KeyAscii As Integer)
Dim rcsVendedor As ADODB.Recordset

    Select Case KeyAscii
    Case 13
        With Me.ActiveControl
        If (.Name = "cmdCancelar") Or (.Name = "cmdSalir") Then Exit Sub
        End With
        If Trim(txtVendedor) = "" Then
            CmdVendedores_Click
        Else
            Set rcsVendedor = New ADODB.Recordset
            ISQL = "SELECT Codigo,Cedula, Nombre FROM TRABAJADORES WHERE Cargo ='003' AND Codigo =" & txtVendedor & " AND Status=1"
            rcsVendedor.Open ISQL, cnnConexion, adOpenStatic, adLockReadOnly, adCmdText
            If Not rcsVendedor.EOF Then
                txtNombreVendedor = rcsVendedor!Nombre
                varCedulaVendedor = rcsVendedor!Cedula
                SpreadMovimiento.SetFocus
            Else
                MsgBox "El vendedor esta inactivo o no existe el código...", vbInformation, "Información"
                txtVendedor = Empty
                txtNombreVendedor = Empty
                varCedulaVendedor = Empty
            End If
            rcsVendedor.Close
            Set rcsVendedor = Nothing
        End If
    Case Asc("0") To Asc("9"), 8
        KeyAscii = KeyAscii
    Case Asc(",")
        If InStr(txtVendedor.Text, ",") <> 0 Then
            KeyAscii = 0
        End If
    Case Else
        KeyAscii = 0
    End Select
End Sub

Private Sub CmdVendedores_Click()
Dim Campo_Captado As Variant

    With Me.ActiveControl
    If (.Name = cmdCancelar.Name) Or (.Name = cmdSalir.Name) Then Exit Sub
    End With
    Campo_Captado = BuscarEnCatalogo(CatVendedor)
    If Trim(Campo_Captado(1)) <> "" Then
       txtVendedor = Campo_Captado(1)
       txtNombreVendedor = Campo_Captado(2)
       varCedulaVendedor = Campo_Captado(3)
       SpreadMovimiento.SetFocus
    Else
       txtVendedor.SetFocus
       txtVendedor = ""
       txtNombreVendedor = ""
       varCedulaVendedor = Empty
    End If
    SpreadMovimiento.SetFocus
End Sub

Private Sub txtPorcentajeDescuento_GotFocus()
    SendKeys "{HOME}+{END}"
End Sub

Private Sub txtPorcentajeDescuento_LostFocus()
    If CDbl(txtPorcentajeDescuento) >= 0 Then
        If CDbl(txtPorcentajeDescuento) < 100 And CDbl(txtPorcentajeDescuento) > 0 Then
            If (MsgBox("No podra ingresar mas items si aplica el descuento en este momento, Finalizo el registro de los artículos...?", vbQuestion + vbYesNo + vbDefaultButton2, "Información") = vbYes) Then
                Call DescuentoPorArticulo
                txtPorcentajeDescuento = Format(txtPorcentajeDescuento, "###,###,###,##0.00")
                Spread.Accion_Spread7 SpreadMovimiento, 1, 1, SpreadMovimiento.MaxRows, SpreadMovimiento.MaxCols, BLOQUEAR
                SpreadMovimiento.SetActiveCell 2, 1
                
            End If
        ElseIf CDbl(txtPorcentajeDescuento) = 0 Then
            Call DescuentoPorArticulo
            txtPorcentajeDescuento = Format(txtPorcentajeDescuento, "###,###,###,##0.00")
            Spread.Accion_Spread7 SpreadMovimiento, 1, 5, SpreadMovimiento.DataRowCnt, 5, DESBLOQUEAR
            Spread.Accion_Spread7 SpreadMovimiento, SpreadMovimiento.DataRowCnt + 1, 2, SpreadMovimiento.DataRowCnt + 1, 2, DESBLOQUEAR
            SpreadMovimiento.SetActiveCell 2, SpreadMovimiento.DataRowCnt + 1
            SpreadMovimiento.SetFocus
        End If
    End If
    txtPorcentajeDescuento.Enabled = False
    Frame3.Enabled = False
    cmdDescuento.Enabled = True
    Call MostrarTotales
End Sub

Private Sub DescuentoPorArticulo()
Dim Fila                As Long
Dim vlista              As String
Dim vPrecioFactura      As Double
Dim VPrecioLista        As Double
Dim vDescuento          As Double
Dim VPorcentajeImpuesto As Variant
Dim VCantidad As Double
Dim vDescuentoTotal As Double
Dim vPorcentajedescuento As String

    With SpreadMovimiento
    Fila = 1
    .Row = Fila
    .Col = 2 'CodigoBarra
    While Fila <= SpreadMovimiento.DataRowCnt
        .Row = Fila: .Col = 1 'Lista de Precio
        vlista = .Text
        If vlista = "P" Then
            .Text = "D"
        End If
        .Row = Fila: .Col = 4 'Precio factura
        vPrecioFactura = .Text
        VPrecioLista = Round(vPrecioFactura - (vPrecioFactura * (txtPorcentajeDescuento / 100)), 2)
        .Row = Fila: .Col = 5 'cantidad
        VCantidad = .Text
        .Row = Fila: .Col = 7
        .Text = VPrecioLista
        vDescuento = vPrecioFactura - (vPrecioFactura - (vPrecioFactura * (txtPorcentajeDescuento / 100)))
        vDescuento = vDescuento
        .Row = Fila: .Col = 8 'Descuento
        .Text = vDescuento
        If VarUsaImpresoraFiscal = 1 Then
            .Row = Fila: .Col = 9 'TotalDescuento
            vPorcentajedescuento = CDbl(txtPorcentajeDescuento) / 100
            .Formula = "F" & Fila & "*" & CorregirComa(vPorcentajedescuento)
        End If
        .Row = Fila: .Col = 12 'PorcentajeImpuesto
        VPorcentajeImpuesto = .Text
        .Row = Fila: .Col = 10 'Impuesto
        If VarUsaImpresoraFiscal Then
            .Text = Round((vPrecioFactura - vDescuento) * (VPorcentajeImpuesto / 100), 2)
        Else
            .Text = (vPrecioFactura - vDescuento) * (VPorcentajeImpuesto / 100)
        End If
        Call RecalcularLinea(SpreadMovimiento, SpreadMovimiento.Row, 4, 5, 12, 11, 6, 7, 8, 9, 10, 17)
        .Col = 2 'CodigoBarra
        Fila = Fila + 1
    Wend
    End With
End Sub

Private Sub CargarMenuContextual()
    If (SpreadMovimiento.DataRowCnt > 0 And SpreadMovimiento.ActiveRow <= SpreadMovimiento.DataRowCnt) Then
        With smxPopUpMain.MenuItems
            .Add 0, "5100", , "Ventana", , , , , True, True
            .Add "5100", "BuscarV", , "&Buscar Valor", gFormaPrincipal.ListaImagenMenu.ListImages(17).Picture, , vbKeyF3, , True, True
            .Add "5100", "IrAFila", , "&Ir a Fila", gFormaPrincipal.ListaImagenMenu.ListImages(28).Picture, , vbKeyF4, , True, True
        End With
    End If
End Sub

Private Sub HabilitarOpcionContingencia()
    bCajaPermiteFacturaContingencia = CajaPermiteFacturaContingencia
    If bCajaPermiteFacturaContingencia And VarUsaImpresoraFiscal = 1 Then
        chkFacturaContingencia.Visible = True
        chkFacturaContingencia.Enabled = True
        chkFacturaContingencia.Value = Checked
    ElseIf Not bCajaPermiteFacturaContingencia And VarUsaImpresoraFiscal = 1 Then
        chkFacturaContingencia.Visible = False
        chkFacturaContingencia.Enabled = False
        chkFacturaContingencia.Value = Unchecked
    ElseIf Not bCajaPermiteFacturaContingencia And VarUsaImpresoraFiscal = 0 Then
        chkFacturaContingencia.Visible = True
        chkFacturaContingencia.Enabled = False
        chkFacturaContingencia.Value = Unchecked
    End If
End Sub



