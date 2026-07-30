export interface SchemaTemplateFile {
  readonly path: string
  readonly content: string
}

export interface SchemaProjectTemplate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly meta: string
  readonly files: readonly SchemaTemplateFile[]
}

export const projectTemplates: readonly SchemaProjectTemplate[] = [
  {
    id: 'editorial-platform',
    name: '内容平台',
    description: '用户、文章、分类与评论，包含多文件和多重关系。',
    meta: '5 模型 · 2 枚举 · 3 文件',
    files: [
      {
        path: 'schema.prisma',
        content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  EDITOR
  ADMIN
}

enum PostStatus {
  DRAFT
  REVIEW
  PUBLISHED
}
`,
      },
      {
        path: 'models/identity.prisma',
        content: `/// 平台用户
model User {
  id        Int       @id @default(autoincrement())
  email     String    @unique
  name      String?
  role      Role      @default(USER)
  posts     Post[]
  comments  Comment[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}
`,
      },
      {
        path: 'models/content.prisma',
        content: `model Post {
  id         Int        @id @default(autoincrement())
  title      String
  slug       String     @unique
  content    String
  status     PostStatus @default(DRAFT)
  authorId   Int
  author     User       @relation(fields: [authorId], references: [id], onDelete: Cascade)
  categoryId Int?
  category   Category?  @relation(fields: [categoryId], references: [id])
  comments   Comment[]
  createdAt  DateTime   @default(now())

  @@index([authorId, status])
}

model Category {
  id    Int    @id @default(autoincrement())
  name  String @unique
  posts Post[]
}

model Comment {
  id        Int      @id @default(autoincrement())
  body      String
  postId    Int
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
}
`,
      },
    ],
  },
  {
    id: 'commerce-core',
    name: '电商核心',
    description: '商品、订单、库存和地址，适合观察复合约束。',
    meta: '6 模型 · 1 枚举 · 单文件',
    files: [
      {
        path: 'schema.prisma',
        content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
  CANCELLED
}

model Customer {
  id        String    @id @default(cuid())
  email     String    @unique
  orders    Order[]
  addresses Address[]
}

model Address {
  id         Int      @id @default(autoincrement())
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  city       String
  detail     String
}

model Product {
  id         String      @id @default(cuid())
  sku        String      @unique
  name       String
  price      Decimal     @db.Decimal(12, 2)
  inventory  Inventory?
  orderItems OrderItem[]
}

model Inventory {
  productId String  @id
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  quantity  Int     @default(0)
}

model Order {
  id         String       @id @default(cuid())
  customerId String
  customer   Customer     @relation(fields: [customerId], references: [id])
  status     OrderStatus  @default(PENDING)
  items      OrderItem[]
  createdAt  DateTime     @default(now())
}

model OrderItem {
  orderId   String
  productId String
  order     Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product   Product @relation(fields: [productId], references: [id])
  quantity  Int
  unitPrice Decimal @db.Decimal(12, 2)

  @@id([orderId, productId])
}
`,
      },
    ],
  },
  {
    id: 'multi-tenant-saas',
    name: '多租户 SaaS',
    description: '组织、成员与项目权限，包含命名关系和自关联。',
    meta: '5 模型 · 2 枚举 · 2 文件',
    files: [
      {
        path: 'schema.prisma',
        content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum MemberRole {
  OWNER
  ADMIN
  MEMBER
}

enum ProjectState {
  ACTIVE
  ARCHIVED
}
`,
      },
      {
        path: 'models/tenant.prisma',
        content: `model User {
  id          String       @id @default(cuid())
  email       String       @unique
  memberships Membership[]
  ownedTasks  Task[]       @relation("TaskOwner")
  createdTasks Task[]      @relation("TaskCreator")
}

model Organization {
  id      String       @id @default(cuid())
  slug    String       @unique
  name    String
  members Membership[]
  projects Project[]
}

model Membership {
  userId         String
  organizationId String
  role           MemberRole   @default(MEMBER)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@id([userId, organizationId])
}

model Project {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String
  state          ProjectState @default(ACTIVE)
  tasks          Task[]

  @@unique([organizationId, name])
}

model Task {
  id        String  @id @default(cuid())
  projectId String
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  title     String
  ownerId   String?
  owner     User?   @relation("TaskOwner", fields: [ownerId], references: [id])
  creatorId String
  creator   User    @relation("TaskCreator", fields: [creatorId], references: [id])
}
`,
      },
    ],
  },
]

export function getProjectTemplate(id: string): SchemaProjectTemplate | undefined {
  return projectTemplates.find((template) => template.id === id)
}
