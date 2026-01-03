class CreateTeamInvitations < ActiveRecord::Migration[8.1]
  def change
    create_table :team_invitations do |t|
      t.string :email, null: false
      t.string :token, null: false
      t.references :team, null: false, foreign_key: true
      t.references :invited_by, null: false, foreign_key: { to_table: :users }
      t.datetime :accepted_at
      t.datetime :expires_at

      t.timestamps
    end

    add_index :team_invitations, :token, unique: true
  end
end
