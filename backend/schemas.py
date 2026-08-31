"""Pydantic 请求/响应模型"""
from typing import List, Optional

from pydantic import BaseModel


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    displayName: str
    role: str
    mustChangePassword: bool = False


class LoginOut(BaseModel):
    ok: bool
    token: str
    user: UserOut


class SetCountIn(BaseModel):
    cabinetId: int
    shelf: int
    count: int


class RenameIn(BaseModel):
    cabinetId: int
    shelf: int
    slot: int
    name: str
    code: Optional[str] = None


class UploadIn(BaseModel):
    cabinetId: int
    shelf: int
    slot: int
    filename: str
    mime: str
    dataBase64: str


class RestoreIn(BaseModel):
    dataBase64: str
    filename: Optional[str] = ''


class ImportRowIn(BaseModel):
    cabinet: int
    layer: int
    slot: int
    name: str
    code: str = ''


class ImportIn(BaseModel):
    rows: List[ImportRowIn]


class UpdateCatalogIn(BaseModel):
    cabinetId: int
    shelves: List[List[str]]
    codes: Optional[List[List[str]]] = None


class ConfigCabinetIn(BaseModel):
    doorType: str
    name: Optional[str] = ''
    shelfColors: Optional[List[str]] = None


class ConfigIn(BaseModel):
    cabinets: List[ConfigCabinetIn]


class UserCreateIn(BaseModel):
    username: str
    displayName: Optional[str] = ''
    password: Optional[str] = None
    role: Optional[str] = 'viewer'


class UserUpdateIn(BaseModel):
    displayName: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None


class ChangePasswordIn(BaseModel):
    oldPassword: str
    newPassword: str


class CabinetOut(BaseModel):
    id: int
    name: str
    doorType: str
    shelfColors: Optional[List[str]] = None
    shelves: List[List[str]]
    codes: List[List[str]] = []


class CatalogOut(BaseModel):
    ok: bool
    cabinets: List[CabinetOut]


class FileOut(BaseModel):
    id: int
    cabinetId: int
    shelf: int
    slot: int
    originalName: str
    mime: str
    size: int
    createdAt: str
    url: str
    previewUrl: str
    downloadable: bool


class AuditOut(BaseModel):
    id: int
    time: str
    username: str
    action: str
    detail: str
    ip: str
