"""Pydantic 请求/响应模型"""
from typing import Optional, List
from pydantic import BaseModel


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    displayName: str
    role: str


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


class UploadIn(BaseModel):
    cabinetId: int
    shelf: int
    slot: int
    filename: str
    mime: str
    dataBase64: str


class UserCreateIn(BaseModel):
    username: str
    displayName: Optional[str] = ''
    password: Optional[str] = '123456'
    role: Optional[str] = 'viewer'


class UserUpdateIn(BaseModel):
    displayName: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None


class CabinetOut(BaseModel):
    id: int
    name: str
    doorType: str
    shelves: List[List[str]]


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
