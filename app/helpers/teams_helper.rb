module TeamsHelper
  def role_badge_class(role)
    case role
    when 'owner'
      'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300'
    when 'admin'
      'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'
    when 'developer'
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
    when 'member'
      'bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-300'
    when 'viewer'
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300'
    else
      'bg-gray-100 text-gray-800 dark:bg-zinc-700 dark:text-zinc-300'
    end
  end
end
