import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireGroups } from "../auth/decorators/require-groups.decorator";
import { GroupsGuard } from "../auth/guards/groups.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserView } from "../users/user-view.util";
import { CreateTransferDto } from "./dto/create-transfer.dto";
import { FindTransfersDto } from "./dto/find-transfers.dto";
import { UpdateTransferDto } from "./dto/update-transfer.dto";
import { TransfersService } from "./transfers.service";

@UseGuards(JwtAuthGuard, GroupsGuard)
@RequireGroups("admin")
@Controller("transfers")
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get("metadata")
  async getMetadata() {
    return this.transfersService.getMetadata();
  }

  @Get()
  async findAll(@Query() findTransfersDto: FindTransfersDto) {
    return this.transfersService.searchTransfers(findTransfersDto);
  }

  @Get(":numero")
  async findOne(@Param("numero", ParseIntPipe) numero: number) {
    return this.transfersService.findOne(numero);
  }

  @Post()
  async create(@Body() createTransferDto: CreateTransferDto, @CurrentUser() user: UserView) {
    return this.transfersService.createTransfer(createTransferDto, user);
  }

  @Patch(":numero")
  async update(
    @Param("numero", ParseIntPipe) numero: number,
    @Body() updateTransferDto: UpdateTransferDto,
  ) {
    return this.transfersService.updateTransfer(numero, updateTransferDto);
  }

  @Post(":numero/approve")
  async approve(@Param("numero", ParseIntPipe) numero: number) {
    return this.transfersService.approveTransfer(numero);
  }

  @Delete(":numero")
  async remove(@Param("numero", ParseIntPipe) numero: number) {
    return this.transfersService.deletePendingTransfer(numero);
  }
}
