class MigrateAppsToTeams < ActiveRecord::Migration[8.1]
  def up
    # For each app with a user_id, create a team and assign it
    # We'll create one team per user, then assign all their apps to that team
    execute <<-SQL
      INSERT INTO teams (name, owner_id, created_at, updated_at)
      SELECT
        users.email_address || '''s Team' as name,
        users.id as owner_id,
        MIN(apps.created_at) as created_at,
        MAX(apps.updated_at) as updated_at
      FROM users
      INNER JOIN apps ON apps.user_id = users.id
      WHERE apps.user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM teams
          WHERE teams.owner_id = users.id
        )
      GROUP BY users.id, users.email_address;
    SQL

    execute <<-SQL
      INSERT INTO team_members (team_id, user_id, role, created_at, updated_at)
      SELECT
        teams.id as team_id,
        teams.owner_id as user_id,
        'admin' as role,
        teams.created_at,
        teams.updated_at
      FROM teams
      WHERE NOT EXISTS (
        SELECT 1 FROM team_members
        WHERE team_members.team_id = teams.id
        AND team_members.user_id = teams.owner_id
      );
    SQL

    execute <<-SQL
      INSERT INTO team_assignments (team_id, app_id, created_at, updated_at)
      SELECT
        teams.id as team_id,
        apps.id as app_id,
        apps.created_at,
        apps.updated_at
      FROM apps
      INNER JOIN teams ON teams.owner_id = apps.user_id
      WHERE apps.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM team_assignments
        WHERE team_assignments.team_id = teams.id
        AND team_assignments.app_id = apps.id
      );
    SQL
  end

  def down
    execute "DELETE FROM team_assignments"
    execute "DELETE FROM team_members"
    execute "DELETE FROM teams"
  end
end
