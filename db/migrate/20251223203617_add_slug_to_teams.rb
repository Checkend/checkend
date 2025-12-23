class AddSlugToTeams < ActiveRecord::Migration[8.1]
  def up
    add_column :teams, :slug, :string
    add_index :teams, :slug, unique: true

    # Generate slugs for existing teams
    Team.reset_column_information
    Team.find_each do |team|
      team.slug = team.name.parameterize
      # Ensure uniqueness
      base_slug = team.slug
      counter = 1
      while Team.where(slug: team.slug).where.not(id: team.id).exists?
        team.slug = "#{base_slug}-#{counter}"
        counter += 1
      end
      team.save(validate: false)
    end

    # Make slug not null after generating slugs
    change_column_null :teams, :slug, false
  end

  def down
    remove_index :teams, :slug
    remove_column :teams, :slug
  end
end
