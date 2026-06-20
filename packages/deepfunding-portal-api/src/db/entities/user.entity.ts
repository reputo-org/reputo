import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'text' })
  collectionId!: string;

  @Column({ type: 'text' })
  userName!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'integer' })
  totalProposals!: number;

  @Column({ type: 'text' })
  did!: string;

  @Column({ type: 'text' })
  rawJson!: string;
}
