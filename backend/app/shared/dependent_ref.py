"""跨模組共用 Dependent DTO — 員工眷屬

:每個 dependent 有對應的 users.id(共用 ULID,= dependents.id)。
報名時 reg.user_id = DependentRef.user_id;ownership / notification 反查時用。
"""

from pydantic import BaseModel, ConfigDict

from app.shared.enums import DependentRelationship


class DependentRef(BaseModel):
    """簡略眷屬引用(用於跨模組互動)"""

    model_config = ConfigDict(frozen=True)

    id: str # dependents.id(=共用 ULID)
    user_id: str # users.id,= dependents.id(共用 ULID,代報時 reg.user_id 用此)
    name: str
    relationship: DependentRelationship
