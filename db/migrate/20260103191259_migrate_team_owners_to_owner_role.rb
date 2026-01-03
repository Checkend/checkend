class MigrateTeamOwnersToOwnerRole < ActiveRecord::Migration[8.1]
  def up
    # For each team, upgrade the owner's team_member role to 'owner'
    execute <<-SQL
      UPDATE team_members
      SET role = 'owner', updated_at = NOW()
      FROM teams
      WHERE team_members.team_id = teams.id
        AND team_members.user_id = teams.owner_id
        AND team_members.role = 'admin'
    SQL
  end

  def down
    # Revert owner roles back to admin
    execute <<-SQL
      UPDATE team_members
      SET role = 'admin', updated_at = NOW()
      WHERE role = 'owner'
    SQL
  end
end
